import React, { useEffect, useRef, useState } from 'react';
import { View, Button, Text, StyleSheet } from 'react-native';
import { RTCPeerConnection, RTCView, mediaDevices } from 'react-native-webrtc';
import io from 'socket.io-client';

import { useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';

const SIGNALING_SERVER_URL = 'http://localhost:5000'; // Change to your server IP if testing on device

const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const VideoCallScreen = () => {
  const route = useRoute();
  const { user } = useAuth();
  const roomId = route.params?.roomId || 'test-room';
  const expertName = route.params?.expertName || '';
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef();
  const pcRef = useRef();
  const remoteSocketId = useRef(null);

  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER_URL);
    socketRef.current.on('connect', () => {
      socketRef.current.emit('join', roomId);
    });
    socketRef.current.on('user-joined', (id) => {
      remoteSocketId.current = id;
      if (route.params?.isInitiator) {
        createOffer();
      }
    });
    socketRef.current.on('signal', async ({ from, signal }) => {
      if (signal.type === 'offer') {
        await createAnswer(signal, from);
      } else if (signal.type === 'answer') {
        await pcRef.current.setRemoteDescription(signal);
      } else if (signal.candidate) {
        await pcRef.current.addIceCandidate(signal);
      }
    });
    return () => {
      socketRef.current.disconnect();
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  const startLocalStream = async () => {
    const stream = await mediaDevices.getUserMedia({ video: true, audio: true });
    setLocalStream(stream);
    setConnected(true);
    createPeerConnection(stream);
  };

  const createPeerConnection = (stream) => {
    pcRef.current = new RTCPeerConnection(configuration);
    pcRef.current.addStream(stream);
    pcRef.current.onaddstream = (event) => {
      setRemoteStream(event.stream);
    };
    pcRef.current.onicecandidate = (event) => {
      if (event.candidate && remoteSocketId.current) {
        socketRef.current.emit('signal', {
          roomId: roomId,
          signal: event.candidate,
          to: remoteSocketId.current,
        });
      }
    };
  };

  const createOffer = async () => {
    if (!pcRef.current) return;
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    socketRef.current.emit('signal', {
      roomId: roomId,
      signal: offer,
      to: remoteSocketId.current,
    });
  };

  const createAnswer = async (offer, from) => {
    remoteSocketId.current = from;
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(offer);
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    socketRef.current.emit('signal', {
      roomId: roomId,
      signal: answer,
      to: from,
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Video Call Demo</Text>
      {expertName ? <Text style={{ marginBottom: 10 }}>Appel avec: {expertName}</Text> : null}
      {!connected ? (
        <Button title="Démarrer la vidéo" onPress={startLocalStream} />
      ) : null}
      {localStream && (
        <RTCView
          streamURL={localStream.toURL()}
          style={styles.stream}
          objectFit="cover"
        />
      )}
      {remoteStream && (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={styles.stream}
          objectFit="cover"
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  stream: { width: 200, height: 200, margin: 10, backgroundColor: '#000' },
});

export default VideoCallScreen;
