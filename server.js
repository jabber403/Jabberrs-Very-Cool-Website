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
const BANNED_FILE = path.join(__dirname, 'banned.json');

// Set your admin username here!
const ADMIN_USERNAME = 'Jabberr';

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function loadBanned() {
    if (!fs.existsSync(BANNED_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8')); } catch (e) { return []; }
}
function saveBanned(banned) { fs.writeFileSync(BANNED_FILE, JSON.stringify(banned, null, 2)); }

// REST endpoints for Login and Signup
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Username and password required.' });
    const trimmed = username.trim();
    
    const banned = loadBanned();
    if (banned.includes(trimmed.toLowerCase())) {
        return res.json({ success: false, message: 'This username is banned from the website.' });
    }

    const users = loadUsers();
    if (users[trimmed]) return res.json({ success: false, message: 'Username already exists.' });
    users[trimmed] = { password: password, following: [], likes: [] };
    saveUsers(users);
    return res.json({ success: true, username: trimmed });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Username and password required.' });
    const trimmed = username.trim();

    const banned = loadBanned();
    if (banned.includes(trimmed.toLowerCase())) {
        return res.json({ success: false, message: 'This account has been banned.' });
    }

    const users = loadUsers();
    if (!users[trimmed] || users[trimmed].password !== password) {
        return res.json({ success: false, message: 'Invalid username or password.' });
    }
    return res.json({ success: true, username: trimmed });
});

let postHistory = [];
let messageHistory = [];
const MAX_HISTORY = 50;
const connectedUsers = {}; // socket.id -> username

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.emit('init_history', { posts: postHistory, messages: messageHistory });

    socket.on('register_user', (username) => {
        if (!username) return;
        const trimmedName = username.trim();

        const banned = loadBanned();
        if (banned.includes(trimmedName.toLowerCase())) {
            socket.emit('banned_error', 'You are banned from this chat.');
            return;
        }

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

    // Chat handling & Admin Commands
    socket.on('chat_message', (data) => {
        const username = data.username ? data.username.trim() : 'Anonymous';
        const text = data.text ? data.text.trim() : '';
        const file = data.file || null;

        // Check for Admin Commands if sent by Jabberr
        if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase() && text.startsWith('/')) {
            const parts = text.split(' ');
            const command = parts[0].toLowerCase();
            const target = parts[1] ? parts[1].trim() : '';

            if (command === '/kick' && target) {
                const targetSocketId = Object.keys(connectedUsers).find(
                    key => connectedUsers[key].toLowerCase() === target.toLowerCase()
                );
                if (targetSocketId) {
                    io.to(targetSocketId).emit('force_disconnect', 'You have been kicked by the admin.');
                    io.sockets.sockets.get(targetSocketId)?.disconnect();
                }
                sendSystemMessage(`⚠️ Admin kicked ${target}.`);
                return;
            } 
            else if (command === '/ban' && target) {
                const banned = loadBanned();
                if (!banned.includes(target.toLowerCase())) {
                    banned.push(target.toLowerCase());
                    saveBanned(banned);
                }
                const targetSocketId = Object.keys(connectedUsers).find(
                    key => connectedUsers[key].toLowerCase() === target.toLowerCase()
                );
                if (targetSocketId) {
                    io.to(targetSocketId).emit('force_disconnect', 'You have been permanently banned by the admin.');
                    io.sockets.sockets.get(targetSocketId)?.disconnect();
                }
                sendSystemMessage(`🔨 Admin permanently banned ${target}.`);
                return;
            }
            else if (command === '/clear') {
                messageHistory = [];
                io.emit('clear_chat');
                sendSystemMessage(`🧹 Admin cleared the chat history.`);
                return;
            }
        }

        const messageData = {
            id: Date.now() + Math.random(),
            type: 'user',
            username: username,
            text: text,
            file: file,
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

function sendSystemMessage(text) {
    const sysMsg = {
        id: Date.now() + Math.random(),
        type: 'system',
        text: text,
        timestamp: new Date().toLocaleTimeString()
    };
    messageHistory.push(sysMsg);
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
    io.emit('chat_message', sysMsg);
}

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