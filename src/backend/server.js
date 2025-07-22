const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'votre_secret_jwt';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://192.168.1.23:8081', 'http://localhost:8081'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  allowUpgrades: true,
  perMessageDeflate: true,
  httpCompression: true,
  path: '/socket.io/'
});


app.use(express.json());
app.use('/api/auth', authRoutes);

const connectedUsers = new Map();
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (userInfo) => {
    const token = userInfo.userId || userInfo._id || userInfo;
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.userId;
      connectedUsers.set(socket.id, {
        userId: userId,
        role: userInfo.role,
        socketId: socket.id,
      });
      console.log(`User ${socket.id} joined with info:`, connectedUsers.get(socket.id));
    } catch (error) {
      console.error(`Invalid token for socket ${socket.id}:`, error);
      socket.emit('error', { message: 'Invalid token' });
      socket.disconnect();
    }
  });

  socket.on('call-expert', ({ expertId, callerName, roomId, callerId }) => {
    console.log(`Call initiated: ${callerName} (${callerId}) -> ${expertId} (Room: ${roomId})`);
    let expertSocketId = null;
    for (let [sId, userInfo] of connectedUsers.entries()) {
      console.log(`Checking user: ${sId}, userId: ${userInfo.userId}, role: ${userInfo.role}`);
      if (userInfo.userId === expertId) {
        expertSocketId = sId;
        break;
      }
    }

    if (expertSocketId) {
      activeRooms.set(roomId, {
        participants: [socket.id],
        expertSocketId: expertSocketId,
        status: 'waiting',
        callerId: callerId,
        expertId: expertId,
      });

      io.to(expertSocketId).emit('incoming-call', {
        callerName,
        roomId,
        callerId,
      });
      console.log(`Incoming call emitted to expert ${expertSocketId} for room ${roomId}`);
    } else {
      socket.emit('call-failed', { message: 'Expert non disponible' });
      console.log(`Call failed: Expert ${expertId} not available. Connected users:`, Array.from(connectedUsers.entries()));
    }
  });

  socket.on('accept-call', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (room && room.expertSocketId === socket.id) {
      room.participants.push(socket.id);
      room.status = 'active';
      
      const [technicianSocketId] = room.participants;
      
      socket.join(roomId);
      io.sockets.sockets.get(technicianSocketId)?.join(roomId);

      io.to(technicianSocketId).emit('call-accepted', { roomId });
      socket.emit('call-accepted', { roomId });
      
      console.log(`Call accepted in room ${roomId}. Participants:`, room.participants);
    } else {
      console.log(`Accept call failed: Room ${roomId} not found or expert socket ID mismatch.`);
    }
  });

  socket.on('join-room', ({ roomId }) => {
    socket.join(roomId);
    const room = activeRooms.get(roomId);

    if (room) {
      if (!room.participants.includes(socket.id)) {
        room.participants.push(socket.id);
      }
      socket.to(roomId).emit('user-joined', socket.id);
      console.log(`User ${socket.id} joined WebRTC room ${roomId}`);
    } else {
      console.log(`User ${socket.id} attempted to join non-existent room ${roomId}`);
    }
  });

  socket.on('decline-call', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      const [technicianSocketId] = room.participants;
      io.to(technicianSocketId).emit('call-declined');
      activeRooms.delete(roomId);
      console.log(`Call declined for room ${roomId}.`);
    } else {
      console.log(`Decline call failed: Room ${roomId} not found.`);
    }
  });

  socket.on('signal', (data) => {
    const { roomId, signal, to } = data;
    
    if (to) {
      io.to(to).emit('signal', {
        from: socket.id,
        signal: signal,
        roomId: roomId
      });
      console.log(`Signal sent from ${socket.id} to ${to} in room ${roomId}: ${signal.type || 'ice-candidate'}`);
    } else if (roomId) {
      socket.to(roomId).emit('signal', {
        from: socket.id,
        signal: signal,
        roomId: roomId
      });
      console.log(`Signal broadcast from ${socket.id} in room ${roomId}: ${signal.type || 'ice-candidate'}`);
    }
  });

  socket.on('end-call', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      room.participants.forEach(participantId => {
        if (participantId !== socket.id) {
          io.to(participantId).emit('call-ended');
        }
        io.sockets.sockets.get(participantId)?.leave(roomId);
      });
      
      activeRooms.delete(roomId);
      console.log(`Call ended and room ${roomId} deleted.`);
    } else {
      console.log(`End call failed: Room ${roomId} not found.`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    connectedUsers.delete(socket.id);
    
    for (let [roomId, room] of activeRooms.entries()) {
      if (room.participants.includes(socket.id)) {
        room.participants
          .filter(id => id !== socket.id)
          .forEach(participantId => {
            io.to(participantId).emit('call-ended', { reason: 'user-disconnected' });
            io.sockets.sockets.get(participantId)?.leave(roomId);
          });
        
        activeRooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up due to user ${socket.id} disconnection.`);
      }
    }
  });
});

mongoose.connect('mongodb://localhost:27017/afifproject')
  .then(() => console.log('Connecté à MongoDB'))
  .catch(err => console.error('Erreur de connexion à MongoDB:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});