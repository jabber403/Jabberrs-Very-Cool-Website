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

// Store recent posts and messages in memory
const postHistory = [];
const messageHistory = [];
const MAX_HISTORY = 50;

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send existing history to the newly connected user
    socket.emit('init_history', { posts: postHistory, messages: messageHistory });

    // Handle incoming chat messages
    socket.on('chat_message', (data) => {
        const messageData = {
            id: Date.now() + Math.random(),
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

    // Handle creating a new post
    socket.on('create_post', (data) => {
        const postData = {
            id: 'post_' + Date.now() + Math.random(),
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            file: data.file || null,
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

    // Handle liking/disliking posts
    socket.on('vote_post', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post) return;

        const username = data.username;

        if (data.type === 'like') {
            if (post.likedBy.includes(username)) {
                // Remove like if already liked
                post.likedBy = post.likedBy.filter(u => u !== username);
                post.likes--;
            } else {
                // Add like and remove dislike if present
                post.likedBy.push(username);
                post.likes++;
                if (post.dislikedBy.includes(username)) {
                    post.dislikedBy = post.dislikedBy.filter(u => u !== username);
                    post.dislikes--;
                }
            }
        } else if (data.type === 'dislike') {
            if (post.dislikedBy.includes(username)) {
                // Remove dislike if already disliked
                post.dislikedBy = post.dislikedBy.filter(u => u !== username);
                post.dislikes--;
            } else {
                // Add dislike and remove like if present
                post.dislikedBy.push(username);
                post.dislikes++;
                if (post.likedBy.includes(username)) {
                    post.likedBy = post.likedBy.filter(u => u !== username);
                    post.likes--;
                }
            }
        }

        io.emit('update_post', post);
    });

    // Handle adding comments to posts
    socket.on('add_comment', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post) return;

        const commentData = {
            id: Date.now() + Math.random(),
            username: data.username ? data.username.trim() : 'Anonymous',
            text: data.text ? data.text.trim() : '',
            timestamp: new Date().toLocaleTimeString()
        };

        if (!commentData.text) return;

        post.comments.push(commentData);
        io.emit('update_post', post);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});