const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // 10MB upload limit
});

app.use(express.static(path.join(__dirname)));
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');

// Helper functions for user storage
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// REST endpoints for Login and Signup
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.json({ success: false, message: 'Username and password required.' });
    }
    const trimmed = username.trim();
    const users = loadUsers();
    if (users[trimmed]) {
        return res.json({ success: false, message: 'Username already exists.' });
    }
    users[trimmed] = {
        password: password,
        following: [],
        likes: []
    };
    saveUsers(users);
    return res.json({ success: true, username: trimmed });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.json({ success: false, message: 'Username and password required.' });
    }
    const trimmed = username.trim();
    const users = loadUsers();
    if (!users[trimmed] || users[trimmed].password !== password) {
        return res.json({ success: false, message: 'Invalid username or password.' });
    }
    return res.json({ success: true, username: trimmed });
});

const postHistory = [];
const messageHistory = [];
const MAX_HISTORY = 50;
const connectedUsers = {}; // socket.id -> username

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.emit('init_history', { posts: postHistory, messages: messageHistory });

    socket.on('register_user', (username) => {
        if (!username) return;
        const trimmedName = username.trim();
        connectedUsers[socket.id] = trimmedName;

        const joinMsg = {
            id: Date.now() + Math.random(),
            type: 'system',
            text: `${trimmedName} has joined the chat.`,
            timestamp: new Date().toLocaleTimeString()
        };
        messageHistory.push(joinMsg);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat_message', joinMsg);

        io.emit('update_user_list', Object.values(connectedUsers));
        sendUserData(socket, trimmedName);
    });

    // Chat handling
    socket.on('chat_message', (data) => {
        const messageData = {
            id: Date.now() + Math.random(),
            type: 'user',
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            file: data.file || null,
            timestamp: new Date().toLocaleTimeString()
        };
        if (!messageData.text && !messageData.file) return;
        messageHistory.push(messageData);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat_message', messageData);
    });

    socket.on('private_message', (data) => {
        const recipientSocketId = Object.keys(connectedUsers).find(
            key => connectedUsers[key] === data.recipient
        );
        const dmData = {
            sender: data.sender,
            recipient: data.recipient,
            text: data.text ? data.text.trim() : '',
            timestamp: new Date().toLocaleTimeString()
        };
        if (!dmData.text) return;
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private_message', dmData);
        }
        socket.emit('private_message', dmData);
    });

    // Posts & Social Features
    socket.on('create_post', (data) => {
        const postData = {
            id: 'post_' + Date.now() + Math.floor(Math.random() * 1000),
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            file: data.file || null,
            shares: 0,
            likes: 0,
            dislikes: 0,
            likedBy: [],
            dislikedBy: [],
            comments: [],
            timestamp: new Date().toLocaleTimeString()
        };
        if (!postData.text && !postData.file) return;
        postHistory.push(postData);
        if (postHistory.length > MAX_HISTORY) postHistory.shift();
        io.emit('new_post', postData);
    });

    socket.on('share_post', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post) return;
        post.shares = (post.shares || 0) + 1;
        io.emit('update_post', post);
    });

    socket.on('vote_post', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post) return;
        const username = data.username;
        if (!post.likedBy) post.likedBy = [];
        if (!post.dislikedBy) post.dislikedBy = [];

        const users = loadUsers();
        if (username && users[username]) {
            if (!users[username].likes) users[username].likes = [];
        }

        if (data.type === 'like') {
            if (post.likedBy.includes(username)) {
                post.likedBy = post.likedBy.filter(u => u !== username);
                post.likes = Math.max(0, post.likes - 1);
                if (users[username] && users[username].likes) {
                    users[username].likes = users[username].likes.filter(id => id !== post.id);
                }
            } else {
                post.likedBy.push(username);
                post.likes++;
                if (users[username]) {
                    if (!users[username].likes) users[username].likes = [];
                    if (!users[username].likes.includes(post.id)) users[username].likes.push(post.id);
                }
                if (post.dislikedBy.includes(username)) {
                    post.dislikedBy = post.dislikedBy.filter(u => u !== username);
                    post.dislikes = Math.max(0, post.dislikes - 1);
                }
            }
        } else if (data.type === 'dislike') {
            if (post.dislikedBy.includes(username)) {
                post.dislikedBy = post.dislikedBy.filter(u => u !== username);
                post.dislikes = Math.max(0, post.dislikes - 1);
            } else {
                post.dislikedBy.push(username);
                post.dislikes++;
                if (post.likedBy.includes(username)) {
                    post.likedBy = post.likedBy.filter(u => u !== username);
                    post.likes = Math.max(0, post.likes - 1);
                    if (users[username] && users[username].likes) {
                        users[username].likes = users[username].likes.filter(id => id !== post.id);
                    }
                }
            }
        }
        saveUsers(users);
        io.emit('update_post', post);
        
        // Refresh target user's data socket if connected
        const targetSocketId = Object.keys(connectedUsers).find(key => connectedUsers[key] === username);
        if (targetSocketId) {
            sendUserData(io.sockets.sockets.get(targetSocketId), username);
        }
    });

    socket.on('add_comment', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post) return;
        if (!post.comments) post.comments = [];
        const commentData = {
            id: Date.now() + Math.random(),
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            replies: [],
            timestamp: new Date().toLocaleTimeString()
        };
        if (!commentData.text) return;
        post.comments.push(commentData);
        io.emit('update_post', post);
    });

    socket.on('add_reply', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post || !post.comments || !post.comments[data.commentIndex]) return;
        const comment = post.comments[data.commentIndex];
        if (!comment.replies) comment.replies = [];
        const replyData = {
            id: Date.now() + Math.random(),
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            timestamp: new Date().toLocaleTimeString()
        };
        if (!replyData.text) return;
        comment.replies.push(replyData);
        io.emit('update_post', post);
    });

    socket.on('toggle_follow', (data) => {
        const users = loadUsers();
        const { follower, target } = data;
        if (!users[follower] || !users[target] || follower === target) return;

        if (!users[follower].following) users[follower].following = [];
        const index = users[follower].following.indexOf(target);
        if (index > -1) {
            users[follower].following.splice(index, 1);
        } else {
            users[follower].following.push(target);
        }
        saveUsers(users);

        // Find the follower's socket and send updated user data
        const followerSocketId = Object.keys(connectedUsers).find(key => connectedUsers[key] === follower);
        if (followerSocketId) {
            sendUserData(io.sockets.sockets.get(followerSocketId), follower);
        }
    });

    socket.on('disconnect', () => {
        const leftName = connectedUsers[socket.id];
        if (leftName) {
            delete connectedUsers[socket.id];
            const leaveMsg = {
                id: Date.now() + Math.random(),
                type: 'system',
                text: `${leftName} has left the chat.`,
                timestamp: new Date().toLocaleTimeString()
            };
            messageHistory.push(leaveMsg);
            if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
            io.emit('chat_message', leaveMsg);
            io.emit('update_user_list', Object.values(connectedUsers));
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

function sendUserData(socket, username) {
    if (!socket) return;
    const users = loadUsers();
    if (users[username]) {
        socket.emit('user_data', {
            username: username,
            following: users[username].following || [],
            likes: users[username].likes || []
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});