const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// In-memory data storage (users, public messages)
let users = []; // stores { username, password, isAdmin, socketId }
let messages = []; // stores public chat messages with timestamps, text, file, username, isAdmin

// Helper to get formatted current time string
function getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Send existing public chat history to newly connected client
    socket.emit('init_history', { messages: messages });

    // Handle user registration / login check
    socket.on('register_user', (username) => {
        // Check if user already exists in memory
        let user = users.find(u => u.username === username);
        if (user) {
            user.socketId = socket.id;
        } else {
            // First user ever or designated admin can be handled here. 
            // Let's check if they are stored as admin or if it's the first account.
            const isAdmin = (users.length === 0 || username.toLowerCase() === 'jabber' || username.toLowerCase() === 'roycter13');
            users.push({ username, isAdmin, socketId: socket.id });
        }

        // Broadcast updated user list with admin status to everyone
        updateUserList();
    });

    // Handle Public Chat Message
    socket.on('chat_message', (data) => {
        const userObj = users.find(u => u.username === data.username);
        const isAdmin = userObj ? userObj.isAdmin : false;

        const msgObj = {
            username: data.username,
            text: data.text || '',
            file: data.file || null,
            timestamp: getTimestamp(),
            isAdmin: isAdmin,
            type: 'user'
        };

        messages.push(msgObj);
        io.emit('chat_message', msgObj);
    });

    // Handle Delete Public Message (Owner or Admin)
    socket.on('delete_public_message', (data) => {
        // data contains: { index, username, isAdmin }
        if (messages[data.index]) {
            const msg = messages[data.index];
            if (msg.username === data.username || data.isAdmin) {
                messages.splice(data.index, 1);
                io.emit('update_public_messages', messages);
            }
        }
    });

    // Handle Edit Public Message (Owner or Admin)
    socket.on('edit_public_message', (data) => {
        // data contains: { index, newText, username, isAdmin }
        if (messages[data.index]) {
            const msg = messages[data.index];
            if (msg.username === data.username || data.isAdmin) {
                msg.text = data.newText;
                io.emit('update_public_messages', messages);
            }
        }
    });

    // Handle Private Direct Messages
    socket.on('private_message', (data) => {
        // data contains: { sender, recipient, text, file }
        data.timestamp = getTimestamp();
        
        // Find recipient socket ID
        const recipientUser = users.find(u => u.username === data.recipient);
        const senderUser = users.find(u => u.username === data.sender);

        if (recipientUser) {
            io.to(recipientUser.socketId).emit('private_message', data);
        }
        if (senderUser) {
            io.to(senderUser.socketId).emit('private_message', data);
        }
    });

    // Typing indicator forwarding
    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        users = users.filter(u => u.socketId !== socket.id);
        updateUserList();
    });
});

function updateUserList() {
    const userListClean = users.map(u => ({ username: u.username, isAdmin: u.isAdmin }));
    io.emit('update_user_list', userListClean);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Jabberrs Chat Server is running smoothly on port ${PORT}!`);
});