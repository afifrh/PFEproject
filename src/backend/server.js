const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// WebRTC signaling logic + call notification
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', (roomId) => {
    socket.join(roomId);
    // No emit here, wait for call
  });

  // Technician initiates a call to expert
  socket.on('call-expert', ({ expertId, callerName }) => {
    io.to(expertId).emit('incoming-call', { callerName });
    console.log(`Call initiated: ${callerName} -> ${expertId}`);
  });

  // Expert declines call
  socket.on('call-declined', ({ expertId }) => {
    io.to(expertId).emit('call-ended');
  });

  // WebRTC signaling
  socket.on('signal', (data) => {
    // data: { roomId, signal, to }
    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Connexion MongoDB
mongoose.connect('mongodb://localhost:27017/afifproject')
.then(() => console.log('Connecté à MongoDB'))
.catch(err => console.error('Erreur de connexion à MongoDB:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});