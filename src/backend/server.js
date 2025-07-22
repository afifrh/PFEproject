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
      // Create room with both participants
      activeRooms.set(roomId, {
        participants: [socket.id], // Technician socket
        expertSocketId: expertSocketId,
        technicianSocketId: socket.id,
        status: 'waiting',
        callerId: callerId,
        expertId: expertId,
        createdAt: Date.now()
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
    console.log(`Accept call request for room: ${roomId} from socket: ${socket.id}`);
    const room = activeRooms.get(roomId);
    
    if (room && room.expertSocketId === socket.id) {
      // Add expert to participants if not already there
      if (!room.participants.includes(socket.id)) {
        room.participants.push(socket.id);
      }
      
      room.status = 'active';
      
      const technicianSocketId = room.technicianSocketId;
      
      // Make both users join the room
      socket.join(roomId);
      const technicianSocket = io.sockets.sockets.get(technicianSocketId);
      if (technicianSocket) {
        technicianSocket.join(roomId);
      }

      // Notify both participants
      io.to(technicianSocketId).emit('call-accepted', { roomId });
      socket.emit('call-accepted', { roomId });
      
      console.log(`Call accepted in room ${roomId}. Participants:`, room.participants);
      console.log(`Room members: technician=${technicianSocketId}, expert=${socket.id}`);
    } else {
      console.log(`Accept call failed: Room ${roomId} not found or expert socket ID mismatch.`);
      console.log(`Room:`, room);
      console.log(`Socket ID:`, socket.id);
    }
  });

  socket.on('join-room', ({ roomId }) => {
    console.log(`Socket ${socket.id} requesting to join room ${roomId}`);
    
    socket.join(roomId);
    const room = activeRooms.get(roomId);

    if (room) {
      if (!room.participants.includes(socket.id)) {
        room.participants.push(socket.id);
        console.log(`Added ${socket.id} to room ${roomId} participants`);
      }
      
      // Notify other participants about the new join
      socket.to(roomId).emit('user-joined', socket.id);
      console.log(`User ${socket.id} joined WebRTC room ${roomId}`);
      console.log(`Room ${roomId} now has participants:`, room.participants);
      
      // If this is an active call with 2 participants, they can start WebRTC
      if (room.status === 'active' && room.participants.length === 2) {
        console.log(`Room ${roomId} ready for WebRTC with 2 participants`);
      }
    } else {
      console.log(`User ${socket.id} attempted to join non-existent room ${roomId}`);
      // Create a temporary room for direct WebRTC connections
      activeRooms.set(roomId, {
        participants: [socket.id],
        status: 'direct',
        createdAt: Date.now()
      });
      console.log(`Created direct room ${roomId} for socket ${socket.id}`);
    }
  });

  socket.on('decline-call', ({ roomId }) => {
    console.log(`Decline call for room: ${roomId}`);
    const room = activeRooms.get(roomId);
    
    if (room) {
      const technicianSocketId = room.technicianSocketId;
      if (technicianSocketId) {
        io.to(technicianSocketId).emit('call-declined');
      }
      activeRooms.delete(roomId);
      console.log(`Call declined for room ${roomId} and room deleted.`);
    } else {
      console.log(`Decline call failed: Room ${roomId} not found.`);
    }
  });

  socket.on('signal', (data) => {
    const { roomId, signal, to } = data;
    
    console.log(`Signal received from ${socket.id}: type=${signal.type || 'ice-candidate'}, roomId=${roomId}, to=${to}`);
    
    if (to) {
      // Direct signaling to specific socket
      io.to(to).emit('signal', {
        from: socket.id,
        signal: signal,
        roomId: roomId
      });
      console.log(`Signal sent from ${socket.id} to ${to} in room ${roomId}`);
    } else if (roomId) {
      // Broadcast to room (excluding sender)
      socket.to(roomId).emit('signal', {
        from: socket.id,
        signal: signal,
        roomId: roomId
      });
      console.log(`Signal broadcast from ${socket.id} in room ${roomId}`);
    }
  });

  socket.on('end-call', ({ roomId }) => {
    console.log(`End call request for room: ${roomId} from socket: ${socket.id}`);
    const room = activeRooms.get(roomId);
    
    if (room) {
      // Notify all other participants
      room.participants.forEach(participantId => {
        if (participantId !== socket.id) {
          io.to(participantId).emit('call-ended', { reason: 'ended-by-peer' });
          // Make them leave the room
          const participantSocket = io.sockets.sockets.get(participantId);
          if (participantSocket) {
            participantSocket.leave(roomId);
          }
        }
      });
      
      // Make current socket leave room
      socket.leave(roomId);
      
      // Delete the room
      activeRooms.delete(roomId);
      console.log(`Call ended and room ${roomId} deleted by ${socket.id}.`);
    } else {
      console.log(`End call failed: Room ${roomId} not found.`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
    
    // Remove from connected users
    connectedUsers.delete(socket.id);
    
    // Handle room cleanup
    for (let [roomId, room] of activeRooms.entries()) {
      if (room.participants.includes(socket.id)) {
        console.log(`Cleaning up room ${roomId} due to disconnection of ${socket.id}`);
        
        // Notify other participants
        room.participants
          .filter(id => id !== socket.id)
          .forEach(participantId => {
            io.to(participantId).emit('call-ended', { reason: 'user-disconnected' });
            const participantSocket = io.sockets.sockets.get(participantId);
            if (participantSocket) {
              participantSocket.leave(roomId);
            }
          });
        
        // Delete the room
        activeRooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up due to user ${socket.id} disconnection.`);
      }
    }
  });

  // Cleanup old rooms periodically (rooms older than 1 hour)
  setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (let [roomId, room] of activeRooms.entries()) {
      if (room.createdAt && (now - room.createdAt) > oneHour) {
        console.log(`Cleaning up old room: ${roomId}`);
        activeRooms.delete(roomId);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
});

mongoose.connect('mongodb://localhost:27017/afifproject')
  .then(() => console.log('Connecté à MongoDB'))
  .catch(err => console.error('Erreur de connexion à MongoDB:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});