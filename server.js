const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // 10MB file upload limit
});

app.use(express.static(path.join(__dirname)));

const postHistory = [];
const messageHistory = [];
const MAX_HISTORY = 50;

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send history depending on what loads
    socket.emit('init_history', { posts: postHistory, messages: messageHistory });

    // Chat events
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

    // Post events
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

    // Vote events (Handling Like/Unlike and Dislike/Undislike cleanly)
    socket.on('vote_post', (data) => {
        const post = postHistory.find(p => p.id === data.postId);
        if (!post) return;
        const username = data.username;

        // Ensure tracking arrays exist
        if (!post.likedBy) post.likedBy = [];
        if (!post.dislikedBy) post.dislikedBy = [];

        if (data.type === 'like') {
            if (post.likedBy.includes(username)) {
                // UNLIKE: If already liked, remove like
                post.likedBy = post.likedBy.filter(u => u !== username);
                post.likes = Math.max(0, post.likes - 1);
            } else {
                // LIKE: Add like, and remove from dislikes if they disliked it before
                post.likedBy.push(username);
                post.likes++;
                if (post.dislikedBy.includes(username)) {
                    post.dislikedBy = post.dislikedBy.filter(u => u !== username);
                    post.dislikes = Math.max(0, post.dislikes - 1);
                }
            }
        } else if (data.type === 'dislike') {
            if (post.dislikedBy.includes(username)) {
                // UNDISLIKE: If already disliked, remove dislike
                post.dislikedBy = post.dislikedBy.filter(u => u !== username);
                post.dislikes = Math.max(0, post.dislikes - 1);
            } else {
                // DISLIKE: Add dislike, and remove from likes if they liked it before
                post.dislikedBy.push(username);
                post.dislikes++;
                if (post.likedBy.includes(username)) {
                    post.likedBy = post.likedBy.filter(u => u !== username);
                    post.likes = Math.max(0, post.likes - 1);
                }
            }
        }
        io.emit('update_post', post);
    });

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