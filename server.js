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

app.set('trust proxy', true);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');
const BANNED_FILE = path.join(__dirname, 'banned_ips.json');

const MASTER_ADMIN = 'Jabberr';

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function loadBannedIPs() {
    if (!fs.existsSync(BANNED_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8')); } catch (e) { return []; }
}
function saveBannedIPs(banned) { fs.writeFileSync(BANNED_FILE, JSON.stringify(banned, null, 2)); }

function getClientIP(reqOrSocket) {
    let forwarded, address;
    if (reqOrSocket.headers) {
        forwarded = reqOrSocket.headers['x-forwarded-for'];
        address = reqOrSocket.ip || reqOrSocket.connection?.remoteAddress;
    } else if (reqOrSocket.handshake) {
        forwarded = reqOrSocket.handshake.headers['x-forwarded-for'];
        address = reqOrSocket.handshake.address;
    }
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return address || '127.0.0.1';
}

app.post('/api/signup', (req, res) => {
    const clientIp = getClientIP(req);
    const bannedIPs = loadBannedIPs();

    if (bannedIPs.includes(clientIp)) {
        return res.json({ success: false, banned: true, message: 'Your IP address is permanently banned from this website.' });
    }

    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Username and password required.' });
    const trimmed = username.trim();

    const users = loadUsers();
    if (users[trimmed]) return res.json({ success: false, message: 'Username already exists.' });
    
    const isMaster = (trimmed.toLowerCase() === MASTER_ADMIN.toLowerCase());
    const isRoycter = (trimmed.toLowerCase() === 'roycter13');
    const isAdmin = isMaster || isRoycter;

    users[trimmed] = { password: password, following: [], likes: [], ip: clientIp, isAdmin: isAdmin };
    saveUsers(users);
    return res.json({ success: true, username: trimmed });
});

app.post('/api/login', (req, res) => {
    const clientIp = getClientIP(req);
    const bannedIPs = loadBannedIPs();

    if (bannedIPs.includes(clientIp)) {
        return res.json({ success: false, banned: true, message: 'Your IP address is permanently banned from this website.' });
    }

    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Username and password required.' });
    const trimmed = username.trim();

    const users = loadUsers();
    if (!users[trimmed] || users[trimmed].password !== password) {
        return res.json({ success: false, message: 'Invalid username or password.' });
    }

    users[trimmed].ip = clientIp;
    if (trimmed.toLowerCase() === MASTER_ADMIN.toLowerCase() || trimmed.toLowerCase() === 'roycter13') {
        users[trimmed].isAdmin = true;
    }
    saveUsers(users);

    return res.json({ success: true, username: trimmed });
});

let postHistory = [];
let messageHistory = [];
const MAX_HISTORY = 50;
const connectedUsers = {}; // socket.id -> { username, ip }

function isUserAdmin(username) {
    if (!username) return false;
    const lower = username.toLowerCase();
    if (lower === MASTER_ADMIN.toLowerCase() || lower === 'roycter13') return true;
    const users = loadUsers();
    const foundKey = Object.keys(users).find(k => k.toLowerCase() === lower);
    return foundKey ? !!users[foundKey].isAdmin : false;
}

function getConnectedUsersPayload() {
    return Object.values(connectedUsers).map(u => ({
        username: u.username,
        isAdmin: isUserAdmin(u.username)
    }));
}

io.on('connection', (socket) => {
    const clientIp = getClientIP(socket);
    const bannedIPs = loadBannedIPs();

    if (bannedIPs.includes(clientIp)) {
        socket.emit('force_ban', 'Your IP address is permanently banned.');
        socket.disconnect(true);
        return;
    }

    socket.emit('init_history', { posts: postHistory, messages: messageHistory });

    socket.on('register_user', (username) => {
        if (!username) return;
        const trimmedName = username.trim();

        if (loadBannedIPs().includes(clientIp)) {
            socket.emit('force_ban', 'Your IP address is permanently banned.');
            socket.disconnect(true);
            return;
        }

        connectedUsers[socket.id] = { username: trimmedName, ip: clientIp };

        const users = loadUsers();
        if (users[trimmedName]) {
            users[trimmedName].ip = clientIp;
            if (trimmedName.toLowerCase() === MASTER_ADMIN.toLowerCase() || trimmedName.toLowerCase() === 'roycter13') {
                users[trimmedName].isAdmin = true;
            }
            saveUsers(users);
        }

        const joinMsg = {
            id: Date.now() + Math.random(),
            type: 'system',
            text: `${trimmedName} has joined the chat.`,
            timestamp: new Date().toLocaleTimeString()
        };
        messageHistory.push(joinMsg);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat_message', joinMsg);

        io.emit('update_user_list', getConnectedUsersPayload());
        sendUserData(socket, trimmedName);
    });

    // Typing Indicator event
    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    socket.on('chat_message', (data) => {
        const username = data.username ? data.username.trim() : 'Anonymous';
        const text = data.text ? data.text.trim() : '';
        const file = data.file || null;

        const hasAdminRights = isUserAdmin(username);

        if (hasAdminRights && text.startsWith('/')) {
            const parts = text.split(' ');
            const cmd1 = parts[0] ? parts[0].toLowerCase() : '';
            const cmd2 = parts[1] ? parts[1].toLowerCase() : '';

            // 1. /kick [username]
            if (cmd1 === '/kick') {
                const target = cmd2.trim();
                if (target.toLowerCase() === MASTER_ADMIN.toLowerCase()) {
                    sendSystemMessage(`⚠️ Nice try! You cannot kick the master admin Jabberr.`);
                    return;
                }
                const targetEntry = Object.entries(connectedUsers).find(
                    ([id, u]) => u.username.toLowerCase() === target.toLowerCase()
                );
                if (targetEntry) {
                    const [targetSocketId] = targetEntry;
                    io.to(targetSocketId).emit('force_disconnect', 'You have been kicked by an admin.');
                    io.sockets.sockets.get(targetSocketId)?.disconnect(true);
                }
                sendSystemMessage(`⚠️ Admin kicked ${target}.`);
                return;
            } 
            
            // 2. /ban [username]
            else if (cmd1 === '/ban') {
                const target = cmd2.trim();
                if (target.toLowerCase() === MASTER_ADMIN.toLowerCase()) {
                    sendSystemMessage(`🛡️ ERROR: Jabberr is immortal and cannot be banned! Nice try.`);
                    return;
                }

                const users = loadUsers();
                const bannedIPs = loadBannedIPs();
                let targetIp = null;

                const targetEntry = Object.entries(connectedUsers).find(
                    ([id, u]) => u.username.toLowerCase() === target.toLowerCase()
                );
                if (targetEntry) {
                    targetIp = targetEntry[1].ip;
                } else {
                    const foundUserKey = Object.keys(users).find(k => k.toLowerCase() === target.toLowerCase());
                    if (foundUserKey && users[foundUserKey].ip) {
                        targetIp = users[foundUserKey].ip;
                    }
                }

                if (targetIp && !bannedIPs.includes(targetIp)) {
                    bannedIPs.push(targetIp);
                    saveBannedIPs(bannedIPs);
                }

                if (targetEntry) {
                    const [targetSocketId] = targetEntry;
                    io.to(targetSocketId).emit('force_ban', 'You have been permanently IP banned by an admin.');
                    io.sockets.sockets.get(targetSocketId)?.disconnect(true);
                }

                sendSystemMessage(`🔨 Admin permanently IP banned ${target} (IP: ${targetIp || 'Unknown'}).`);
                return;
            }

            // 3. /get ip [username]
            else if (cmd1 === '/get' && cmd2 === 'ip') {
                const target = parts[2] ? parts[2].trim() : '';
                if (!target) {
                    sendSystemMessage(`⚠️ Usage: /get ip [username]`);
                    return;
                }

                const users = loadUsers();
                let targetIp = 'Not found';
                const targetEntry = Object.entries(connectedUsers).find(
                    ([id, u]) => u.username.toLowerCase() === target.toLowerCase()
                );
                if (targetEntry) {
                    targetIp = targetEntry[1].ip;
                } else {
                    const foundUserKey = Object.keys(users).find(k => k.toLowerCase() === target.toLowerCase());
                    if (foundUserKey && users[foundUserKey].ip) {
                        targetIp = users[foundUserKey].ip;
                    }
                }

                sendSystemMessage(`🔍 Admin Tool -> IP for ${target}: ${targetIp}`);
                return;
            }

            // 4. /add admin [username]
            else if (cmd1 === '/add' && cmd2 === 'admin') {
                const isMaster = username.toLowerCase() === MASTER_ADMIN.toLowerCase();
                if (!isMaster) {
                    sendSystemMessage(`❌ Only the master admin Jabberr can promote new admins.`);
                    return;
                }
                const target = parts[2] ? parts[2].trim() : '';
                if (!target) {
                    sendSystemMessage(`⚠️ Usage: /add admin [username]`);
                    return;
                }

                const users = loadUsers();
                const foundUserKey = Object.keys(users).find(k => k.toLowerCase() === target.toLowerCase());
                if (foundUserKey) {
                    users[foundUserKey].isAdmin = true;
                    saveUsers(users);
                    sendSystemMessage(`👑 Success! ${foundUserKey} has been promoted to Admin.`);
                    io.emit('update_user_list', getConnectedUsersPayload());
                } else {
                    sendSystemMessage(`❌ User '${target}' not found in database.`);
                }
                return;
            }

            // 5. /clear
            else if (cmd1 === '/clear') {
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
            isAdmin: hasAdminRights,
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
            key => connectedUsers[key].username.toLowerCase() === (data.recipient || '').toLowerCase()
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
        
        const targetSocketId = Object.keys(connectedUsers).find(key => connectedUsers[key].username === username);
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

        const followerSocketId = Object.keys(connectedUsers).find(key => connectedUsers[key].username === follower);
        if (followerSocketId) {
            sendUserData(io.sockets.sockets.get(followerSocketId), follower);
        }
    });

    socket.on('disconnect', () => {
        const userEntry = connectedUsers[socket.id];
        if (userEntry) {
            const leftName = userEntry.username;
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
            io.emit('update_user_list', getConnectedUsersPayload());
        }
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

// Add inside your io.on('connection', (socket) => { ... }) block:

    socket.on('music_action', (data) => {
        // Broadcast play/pause and timestamp to all other connected clients
        socket.broadcast.emit('music_sync', data);
    });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});