const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // Allow up to 10MB file uploads
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Store recent messages in memory
const messageHistory = [];
const MAX_HISTORY = 50;

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send existing message history to the newly connected user
    socket.emit('init_history', messageHistory);

    // Handle incoming chat messages (text or files)
    socket.on('chat_message', (data) => {
        const messageData = {
            id: Date.now() + Math.random(),
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            file: data.file || null, // { name, type, data }
            timestamp: new Date().toLocaleTimeString()
        };

        if (!messageData.text && !messageData.file) return;

        // Save to history
        messageHistory.push(messageData);
        if (messageHistory.length > MAX_HISTORY) {
            messageHistory.shift();
        }

        // Broadcast to everyone including the sender
        io.emit('chat_message', messageData);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});