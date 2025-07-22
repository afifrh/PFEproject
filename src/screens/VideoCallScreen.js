import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Button, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { RTCPeerConnection, RTCView, mediaDevices } from 'react-native-webrtc';
import io from 'socket.io-client';
import { useRoute } from '@react-navigation/native';
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
  const { user } = useAuth();
  const roomId = route.params?.roomId || 'test-room';
  const expertName = route.params?.expertName || '';
  const isInitiator = route.params?.isInitiator || false;
  
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const remoteSocketId = useRef(null);

  const emitSocketEvent = useCallback((eventName, data) => {
    if (!socketRef.current) {
      console.error(`Cannot emit ${eventName}: Socket is null`);
      return false;
    }
    
    if (!socketRef.current.connected) {
      console.error(`Cannot emit ${eventName}: Socket is not connected`);
      return false;
    }
    
    try {
      console.log(`Emitting ${eventName} event:`, data);
      socketRef.current.emit(eventName, data);
      return true;
    } catch (error) {
      console.error(`Error emitting ${eventName}:`, error);
      return false;
    }
  }, []);

  const initializeCall = async () => {
    try {
      console.log('Initializing call...');
      await startLocalStream();
      if (socketRef.current?.connected) {
        console.log('Local stream started, joining room:', roomId);
        emitSocketEvent('join-room', { roomId });
      } else {
        console.error('Socket not connected, cannot join room');
        handleError('Socket connection not established');
      }
    } catch (error) {
      console.error('Call initialization error:', error);
      handleError('Failed to initialize call: ' + error.message);
    }
  };

  const handleError = useCallback((message) => {
    console.error(message);
    setError(message);
    setIsLoading(false);
    Alert.alert('Erreur', message);
  }, []);

  const cleanup = useCallback(() => {
    console.log('Cleaning up VideoCallScreen...');
    try {
      if (localStream) {
        console.log('Stopping local stream tracks...');
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped track:', track.kind);
        });
      }

      if (pcRef.current) {
        console.log('Closing peer connection...');
        // Check if the connection is not already closed
        if (pcRef.current.iceConnectionState !== 'closed') {
          pcRef.current.close();
        }
        pcRef.current = null;
      }

      if (socketRef.current) {
        console.log('Disconnecting socket...');
        if (socketRef.current.connected) {
          socketRef.current.disconnect();
        }
        socketRef.current = null;
      }

      setLocalStream(null);
      setRemoteStream(null);
      setConnected(false);
      setSocketConnected(false);
      console.log('Cleanup completed successfully');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }, [localStream]);

  useEffect(() => {
    return () => {
      console.log('Component unmounting, performing cleanup...');
      cleanup();
    };
  }, [cleanup]);

  const createPeerConnection = useCallback((stream) => {
    try {
      if (pcRef.current) {
        console.log('Closing existing PeerConnection before creating a new one');
        pcRef.current.close();
        pcRef.current = null;
      }
      
      console.log('Initializing PeerConnection with stream:', stream.id);
      pcRef.current = new RTCPeerConnection(configuration);
      
      // Utiliser addStream au lieu de addTrack
      pcRef.current.addStream(stream);
      console.log('Stream added to PeerConnection');
      
      pcRef.current.onaddstream = (event) => {
        console.log('Received remote stream');
        setRemoteStream(event.stream);
      };
      
      pcRef.current.onicecandidate = (event) => {
        if (event.candidate && remoteSocketId.current && socketRef.current?.connected) {
          console.log('Sending ICE candidate to remote peer');
          socketRef.current.emit('signal', {
            roomId,
            signal: event.candidate,
            to: remoteSocketId.current,
          });
        }
      };
      
      pcRef.current.oniceconnectionstatechange = () => {
        if (!pcRef.current) {
          console.log('PeerConnection is null, cannot check iceConnectionState');
          return;
        }
        
        console.log('ICE connection state:', pcRef.current.iceConnectionState);
        if (pcRef.current.iceConnectionState === 'failed') {
          handleError('Connection failed');
        }
      };

      console.log('PeerConnection initialized successfully');
      
    } catch (error) {
      console.error('PeerConnection creation failed:', error);
      handleError('Failed to create peer connection: ' + error.message);
    }
  }, [roomId, handleError]);

  const startLocalStream = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const stream = await mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      setLocalStream(stream);
      setConnected(true);
      createPeerConnection(stream);
      
    } catch (error) {
      handleError('Failed to get media devices');
    } finally {
      setIsLoading(false);
    }
  }, [createPeerConnection, handleError]);

  const createOffer = useCallback(async () => {
    try {
      if (!pcRef.current) {
        throw new Error('PeerConnection not initialized');
      }

      if (!localStream) {
        throw new Error('Local stream not available');
      }
      
      if (!socketRef.current?.connected) {
        throw new Error('Socket not connected');
      }

      console.log('Creating offer, PeerConnection state:', pcRef.current.connectionState);
      const offer = await pcRef.current.createOffer();
      console.log('Offer created successfully:', offer);
      await pcRef.current.setLocalDescription(offer);
      console.log('Local description set successfully');
      
      emitSocketEvent('signal', {
        roomId,
        signal: offer,
        to: remoteSocketId.current,
      });
      console.log('Offer sent to remote peer:', remoteSocketId.current);
    } catch (error) {
      console.error('Offer creation failed:', error);
      handleError('Failed to create offer: ' + error.message);
    }
  }, [roomId, handleError, localStream, emitSocketEvent]);

  const createAnswer = useCallback(async (offer, from) => {
    try {
      if (!pcRef.current) {
        console.error('PeerConnection is null, cannot create answer');
        return;
      }
      
      if (!socketRef.current?.connected) {
        console.error('Socket not connected, cannot send answer');
        return;
      }
      
      remoteSocketId.current = from;
      await pcRef.current.setRemoteDescription(offer);
      
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      
      emitSocketEvent('signal', {
        roomId,
        signal: answer,
        to: from,
      });
    } catch (error) {
      console.error('Answer creation failed:', error);
      handleError('Failed to create answer: ' + error.message);
    }
  }, [roomId, handleError, emitSocketEvent]);

  const handleSocketSignal = useCallback(
    async ({ from, signal }) => {
      console.log(`Received signal from ${from}:`, signal);
      try {
        if (!pcRef.current) {
          console.error('PeerConnection is null, cannot process signal');
          return;
        }
        
        if (signal.type === 'offer') {
          console.log('Processing offer from', from);
          await createAnswer(signal, from);
        } else if (signal.type === 'answer') {
          console.log('Processing answer from', from);
          await pcRef.current.setRemoteDescription(signal);
        } else if (signal.candidate) {
          console.log('Processing ICE candidate from', from);
          await pcRef.current.addIceCandidate(signal);
        }
      } catch (error) {
        console.error('Signal handling failed:', error);
        handleError('Signal handling failed: ' + error.message);
      }
    },
    [createAnswer, handleError]
  );

  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      withCredentials: false,
      forceNew: true,
      autoConnect: true
    });

    socketRef.current.on('connect', () => {
      console.log('Socket connected successfully');
      setSocketConnected(true);
      initializeCall();
    });

    socketRef.current.on('disconnect', () => {
      console.log('Socket disconnected');
      setSocketConnected(false);
      handleError('Disconnected from server');
    });
    
    socketRef.current.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      handleError('Connection error: ' + error.message);
    });

    socketRef.current.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
      if (localStream) {
        console.log('Rejoining room after reconnection');
        socketRef.current.emit('join-room', { roomId });
      }
    });

    socketRef.current.on('reconnect_error', (error) => {
      console.error('Socket reconnection error:', error);
      handleError('Reconnection failed: ' + error.message);
    });

    socketRef.current.on('reconnect_failed', () => {
      console.error('Socket reconnection failed after all attempts');
      handleError('Failed to reconnect after multiple attempts');
      cleanup();
    });
    
    socketRef.current.on('user-joined', (id) => {
      console.log('User joined:', id);
      remoteSocketId.current = id;
      if (isInitiator && pcRef.current) {
        createOffer();
      }
    });
    
    socketRef.current.on('signal', handleSocketSignal);
    
    socketRef.current.on('disconnect', () => {
      handleError('Disconnected from server');
    });
    
    return cleanup;
  }, [roomId, isInitiator, createOffer, handleSocketSignal, cleanup, handleError, startLocalStream]);

  const handleRetryConnection = useCallback(() => {
    console.log('Retrying connection...');
    cleanup();
    if (socketRef.current) {
      socketRef.current.connect();
    } else {
      initializeCall();
    }
  }, [cleanup, initializeCall]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Appel Vidéo</Text>
      {expertName && <Text style={styles.subtitle}>Avec: {expertName}</Text>}
      
      <View style={styles.statusContainer}>
        <Text style={[styles.statusText, socketConnected ? styles.connected : styles.disconnected]}>
          {socketConnected ? 'Connecté' : 'Déconnecté'}
        </Text>
        {!socketConnected && (
          <Button 
            title="Réessayer" 
            onPress={handleRetryConnection}
            disabled={isLoading}
          />
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      
      {!connected ? (
        <Button 
          title={isLoading ? "Connexion..." : "Démarrer l'appel"} 
          onPress={startLocalStream} 
          disabled={isLoading || !socketConnected}
        />
      ) : null}
      
      <View style={styles.videoContainer}>
        {remoteStream ? (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text>En attente de connexion...</Text>
          </View>
        )}
        
        {localStream && (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
          />
        )}
      </View>
      
      {isLoading && <ActivityIndicator size="large" />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center'
  },
  error: {
    color: 'red',
    marginBottom: 20,
    textAlign: 'center'
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20
  },
  remoteVideo: {
    width: '100%',
    height: '70%',
    backgroundColor: 'black'
  },
  localVideo: {
    position: 'absolute',
    width: 100,
    height: 150,
    right: 20,
    bottom: 20,
    backgroundColor: 'black'
  },
  placeholder: {
    width: '100%',
    height: '70%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eee'
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    gap: 10
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold'
  },
  connected: {
    color: '#4CAF50'
  },
  disconnected: {
    color: '#f44336'
  }
});

export default VideoCallScreen;