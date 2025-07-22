import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Button, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { RTCPeerConnection, RTCView, mediaDevices } from 'react-native-webrtc';
import io from 'socket.io-client';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';

const SIGNALING_SERVER_URL = 'http://192.168.1.23:5000';
const configuration = { 
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ] 
};

const VideoCallScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  const roomId = route.params?.roomId || 'test-room';
  const expertName = route.params?.expertName || route.params?.callerName || '';
  const isInitiator = route.params?.isInitiator || false;
  
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [callState, setCallState] = useState('connecting'); // connecting, connected, ended
  
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const remoteSocketId = useRef(null);
  const isCleaningUp = useRef(false);

  const handleError = useCallback((message) => {
    if (isCleaningUp.current) return;
    
    console.error('VideoCall Error:', message);
    setError(message);
    setIsLoading(false);
    setCallState('ended');
  }, []);

  const cleanup = useCallback(() => {
    if (isCleaningUp.current) return;
    isCleaningUp.current = true;
    
    console.log('Cleaning up VideoCallScreen...');
    
    try {
      // Stop local stream
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped track:', track.kind);
        });
      }

      // Close peer connection
      if (pcRef.current) {
        try {
          if (pcRef.current.iceConnectionState !== 'closed') {
            pcRef.current.close();
          }
        } catch (error) {
          console.error('Error closing peer connection:', error);
        }
        pcRef.current = null;
      }

      // End call on server and disconnect socket
      if (socketRef.current && socketRef.current.connected) {
        try {
          socketRef.current.emit('end-call', { roomId });
          socketRef.current.disconnect();
        } catch (error) {
          console.error('Error during socket cleanup:', error);
        }
      }
      socketRef.current = null;

      // Reset state
      setLocalStream(null);
      setRemoteStream(null);
      setConnected(false);
      setSocketConnected(false);
      remoteSocketId.current = null;
      
      console.log('Cleanup completed successfully');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }, [localStream, roomId]);

  const endCall = useCallback(() => {
    console.log('Ending call...');
    cleanup();
    navigation.goBack();
  }, [cleanup, navigation]);

  const createPeerConnection = useCallback((stream) => {
    if (isCleaningUp.current) return null;
    
    try {
      if (pcRef.current) {
        console.log('Closing existing PeerConnection');
        pcRef.current.close();
      }
      
      console.log('Creating new PeerConnection');
      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;
      
      // Add stream
      pc.addStream(stream);
      console.log('Local stream added to PeerConnection');
      
      // Handle remote stream
      pc.onaddstream = (event) => {
        console.log('Remote stream received');
        if (!isCleaningUp.current) {
          setRemoteStream(event.stream);
          setCallState('connected');
        }
      };
      
      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && remoteSocketId.current && socketRef.current?.connected) {
          console.log('Sending ICE candidate');
          socketRef.current.emit('signal', {
            roomId,
            signal: event.candidate,
            to: remoteSocketId.current,
          });
        }
      };
      
      // Handle connection state changes
      pc.oniceconnectionstatechange = () => {
        if (!pcRef.current || isCleaningUp.current) return;
        
        const state = pcRef.current.iceConnectionState;
        console.log('ICE connection state:', state);
        
        switch (state) {
          case 'connected':
          case 'completed':
            setCallState('connected');
            break;
          case 'failed':
          case 'disconnected':
          case 'closed':
            if (!isCleaningUp.current) {
              handleError('Connection lost');
            }
            break;
        }
      };

      return pc;
    } catch (error) {
      console.error('Failed to create PeerConnection:', error);
      handleError('Failed to create peer connection');
      return null;
    }
  }, [roomId, handleError]);

  const startLocalStream = useCallback(async () => {
    if (isCleaningUp.current) return;
    
    try {
      console.log('Starting local stream...');
      setIsLoading(true);
      setError(null);
      
      const stream = await mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      if (isCleaningUp.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      setLocalStream(stream);
      setConnected(true);
      
      // Create peer connection with the stream
      const pc = createPeerConnection(stream);
      if (!pc) {
        throw new Error('Failed to create peer connection');
      }
      
      console.log('Local stream started successfully');
      
    } catch (error) {
      console.error('Failed to start local stream:', error);
      handleError('Cannot access camera/microphone');
    } finally {
      setIsLoading(false);
    }
  }, [createPeerConnection, handleError]);

  const createOffer = useCallback(async () => {
    if (isCleaningUp.current || !pcRef.current || !socketRef.current?.connected) {
      console.log('Cannot create offer: invalid state');
      return;
    }

    try {
      console.log('Creating offer...');
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      
      socketRef.current.emit('signal', {
        roomId,
        signal: offer,
        to: remoteSocketId.current,
      });
      
      console.log('Offer sent successfully');
    } catch (error) {
      console.error('Failed to create offer:', error);
      handleError('Failed to initiate call');
    }
  }, [roomId, handleError]);

  const createAnswer = useCallback(async (offer, from) => {
    if (isCleaningUp.current || !pcRef.current || !socketRef.current?.connected) {
      console.log('Cannot create answer: invalid state');
      return;
    }
    
    try {
      console.log('Creating answer for offer from:', from);
      remoteSocketId.current = from;
      
      await pcRef.current.setRemoteDescription(offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      
      socketRef.current.emit('signal', {
        roomId,
        signal: answer,
        to: from,
      });
      
      console.log('Answer sent successfully');
    } catch (error) {
      console.error('Failed to create answer:', error);
      handleError('Failed to answer call');
    }
  }, [roomId, handleError]);

  const handleSocketSignal = useCallback(async ({ from, signal }) => {
    if (isCleaningUp.current || !pcRef.current) {
      console.log('Ignoring signal: cleanup in progress or no peer connection');
      return;
    }
    
    try {
      console.log(`Processing signal from ${from}:`, signal.type || 'ice-candidate');
      
      if (signal.type === 'offer') {
        await createAnswer(signal, from);
      } else if (signal.type === 'answer') {
        await pcRef.current.setRemoteDescription(signal);
        console.log('Answer processed successfully');
      } else if (signal.candidate) {
        await pcRef.current.addIceCandidate(signal);
        console.log('ICE candidate added');
      }
    } catch (error) {
      console.error('Failed to handle signal:', error);
      // Don't show error for ICE candidate failures as they're common
      if (signal.type === 'offer' || signal.type === 'answer') {
        handleError('Call connection failed');
      }
    }
  }, [createAnswer, handleError]);

  // Initialize socket connection and join room
  useEffect(() => {
    if (isCleaningUp.current) return;

    console.log('Initializing socket connection for room:', roomId);
    
    socketRef.current = io(SIGNALING_SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      transports: ['websocket', 'polling'],
      forceNew: true
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      if (isCleaningUp.current) return;
      
      console.log('Socket connected, joining room...');
      setSocketConnected(true);
      
      // Join the room
      socket.emit('join-room', { roomId });
      
      // Identify user
      socket.emit('join', {
        userId: user.token,
        role: user.role
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setSocketConnected(false);
      if (!isCleaningUp.current) {
        handleError('Disconnected from server');
      }
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      if (!isCleaningUp.current) {
        handleError('Connection failed');
      }
    });

    socket.on('user-joined', (id) => {
      if (isCleaningUp.current) return;
      
      console.log('User joined room:', id);
      remoteSocketId.current = id;
      
      // If this is the initiator and we have local stream, create offer
      if (isInitiator && localStream && pcRef.current) {
        console.log('Creating offer as initiator');
        createOffer();
      }
    });

    socket.on('signal', handleSocketSignal);

    socket.on('call-ended', ({ reason }) => {
      console.log('Call ended by remote:', reason);
      if (!isCleaningUp.current) {
        Alert.alert('Appel terminé', 'L\'autre participant a quitté l\'appel');
        endCall();
      }
    });

    // Start local stream
    startLocalStream();

    return () => {
      console.log('VideoCallScreen unmounting');
      cleanup();
    };
  }, [roomId, isInitiator, user, createOffer, handleSocketSignal, startLocalStream, endCall, cleanup, handleError]);

  // Handle local stream changes
  useEffect(() => {
    if (localStream && socketRef.current?.connected && !remoteSocketId.current && isInitiator) {
      // Wait a bit for the other user to join
      const timer = setTimeout(() => {
        if (pcRef.current && !remoteSocketId.current) {
          console.log('No remote user found, but peer connection exists');
        }
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [localStream, isInitiator]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Appel Vidéo</Text>
        {expertName && <Text style={styles.subtitle}>Avec: {expertName}</Text>}
        
        <View style={styles.statusContainer}>
          <Text style={[styles.statusText, socketConnected ? styles.connected : styles.disconnected]}>
            {socketConnected ? '🟢 Connecté' : '🔴 Déconnecté'}
          </Text>
          <Text style={styles.callState}>
            État: {callState === 'connecting' ? 'Connexion...' : 
                   callState === 'connected' ? 'En cours' : 'Terminé'}
          </Text>
        </View>
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={startLocalStream}>
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      )}
      
      <View style={styles.videoContainer}>
        {remoteStream ? (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
            mirror={false}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {callState === 'connecting' ? 'En attente de connexion...' : 'Aucun flux vidéo'}
            </Text>
            {isLoading && <ActivityIndicator size="large" color="#007AFF" />}
          </View>
        )}
        
        {localStream && (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            mirror={true}
          />
        )}
      </View>
      
      <View style={styles.controls}>
        <TouchableOpacity style={styles.endCallButton} onPress={endCall}>
          <Text style={styles.endCallButtonText}>Raccrocher</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 15,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  connected: {
    color: '#4CAF50',
  },
  disconnected: {
    color: '#f44336',
  },
  callState: {
    fontSize: 14,
    color: '#fff',
  },
  errorContainer: {
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    padding: 15,
    margin: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  error: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
  retryButton: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 5,
  },
  retryButtonText: {
    color: '#f44336',
    fontWeight: 'bold',
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  localVideo: {
    position: 'absolute',
    width: 120,
    height: 160,
    right: 20,
    top: 20,
    backgroundColor: '#000',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
  },
  placeholderText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  controls: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 20,
    alignItems: 'center',
  },
  endCallButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  endCallButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default VideoCallScreen;