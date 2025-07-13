import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, FlatList, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import userService from '../api/userService';

const SIGNALING_SERVER_URL = 'http://localhost:5000'; // Change to your server IP if needed

const HomeScreen = ({ navigation }) => {
  const { signOut, user } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null);
  const [userList, setUserList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [calledExpertId, setCalledExpertId] = useState(null);
  const socketRef = useRef();

  // For expert: listen for incoming call
  useEffect(() => {
    if (user && user.role === 'expert') {
      socketRef.current = io(SIGNALING_SERVER_URL);
      
      socketRef.current.on('connect', () => {
        console.log('Expert connected to socket');
        socketRef.current.emit('join', user.token);
      });
      
      socketRef.current.on('incoming-call', (callData) => {
        console.log('Incoming call received:', callData);
        setIncomingCall(callData);
      });
      
      socketRef.current.on('call-ended', () => {
        console.log('Call ended');
        setIncomingCall(null);
        setCallActive(false);
      });
      
      socketRef.current.on('disconnect', () => {
        console.log('Expert disconnected from socket');
      });
      
      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    }
  }, [user]);

  // Fetch list depending on role
  useEffect(() => {
    if (user && user.role) {
      setLoading(true);
      const fetchList = user.role === 'technician' ? userService.getExperts : userService.getTechnicians;
      fetchList()
        .then(data => {
          setUserList(Array.isArray(data) ? data : []);
          console.log('Fetched list:', data);
        })
        .catch((err) => {
          setUserList([]);
          console.log('Error fetching list:', err);
        })
        .finally(() => setLoading(false));
    }
  }, [user]);

  // Technician: call expert
  const handleCall = (expert) => {
    if (callActive) return;
    setCallActive(true);
    setCalledExpertId(expert._id);
    // Notify expert via socket
    if (!socketRef.current) {
      socketRef.current = io(SIGNALING_SERVER_URL);
    }
    socketRef.current.emit('call-expert', {
      expertId: expert._id,
      callerName: user.name || user.email || 'Technicien',
    });
    // Navigate to video call screen
    navigation.navigate('VideoCall', {
      roomId: expert._id,
      expertName: expert.name,
      isInitiator: true,
    });
  };

  // Expert: join call
  const handleJoin = () => {
    if (!incomingCall) return;
    
    setCallActive(true);
    setIncomingCall(null);
    
    // Navigate to video call screen
    navigation.navigate('VideoCall', { 
      roomId: user.token,
      callerName: incomingCall.callerName || 'Technicien',
      isInitiator: false
    });
  };

  // Expert: decline call
  const handleDecline = () => {
    setIncomingCall(null);
    if (socketRef.current) {
      socketRef.current.emit('call-declined', { expertId: user.token });
    }
  };

  // Handle sign out
  const handleSignOut = async () => {
    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      Alert.alert('Erreur', 'Problème lors de la déconnexion');
    }
  };

  // Reset call state when navigating back
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setCallActive(false);
      setCalledExpertId(null);
    });

    return unsubscribe;
  }, [navigation]);

  

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.welcomeText}>
          Bienvenue, {user.name || user.email}
        </Text>
        <Text style={styles.roleText}>
          Rôle: {user.role === 'expert' ? 'Expert' : 'Technicien'}
        </Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Déconnexion</Text>
        </TouchableOpacity>
      </View>

      {/* Technician View */}
      <View style={user.role === 'technician' ? styles.technicianContainer : styles.expertContainer}>
        <Text style={styles.sectionTitle}>
          {user.role === 'technician' ? 'Liste des Experts' : 'Liste des Techniciens'}
        </Text>
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" />
        ) : (
          <>
            <Text style={styles.expertsCount}>
              {user.role === 'technician'
                ? `Experts trouvés: ${userList.length}`
                : `Techniciens trouvés: ${userList.length}`}
            </Text>
            <FlatList
              data={userList}
              keyExtractor={item => item._id}
              renderItem={({ item }) => (
                <View style={styles.expertItem}>
                  <View style={styles.expertInfo}>
                    <Text style={styles.expertName}>{item.name}</Text>
                  </View>
                  {user.role === 'technician' ? (
                    <TouchableOpacity
                      style={[
                        styles.callButton,
                        callActive && calledExpertId === item._id && styles.callButtonActive,
                        callActive && styles.callButtonDisabled
                      ]}
                      onPress={() => handleCall(item)}
                      disabled={callActive}
                    >
                      <Text style={styles.callButtonText}>
                        {callActive && calledExpertId === item._id ? 'En appel...' : 'Appeler'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.callButton, !incomingCall && styles.callButtonDisabled]}
                      onPress={handleJoin}
                      disabled={!incomingCall}
                    >
                      <Text style={styles.callButtonText}>{incomingCall ? 'Rejoindre' : 'Rejoindre (en attente)'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Aucun utilisateur trouvé.</Text>
              }
              refreshing={loading}
              onRefresh={() => {
                setLoading(true);
                const fetchList = user.role === 'technician' ? userService.getExperts : userService.getTechnicians;
                fetchList()
                  .then(data => setUserList(Array.isArray(data) ? data : []))
                  .catch(() => setUserList([]))
                  .finally(() => setLoading(false));
              }}
            />
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  roleText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
  },
  signOutButton: {
    backgroundColor: '#dc3545',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  signOutText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  technicianContainer: {
    flex: 1,
  },
  expertContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  expertsCount: {
    color: '#007AFF',
    marginBottom: 10,
    fontSize: 14,
  },
  expertItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    marginBottom: 10,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  expertInfo: {
    flex: 1,
  },
  expertName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  expertStatus: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  callButton: {
    backgroundColor: '#28a745',
    padding: 12,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  callButtonActive: {
    backgroundColor: '#ffc107',
  },
  callButtonDisabled: {
    backgroundColor: '#ccc',
  },
  callButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 20,
  },
  loadingText: {
    marginTop: 20,
    color: '#666',
  },
  incomingCallContainer: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  incomingCallText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  callActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  acceptButton: {
    backgroundColor: '#28a745',
    marginHorizontal: 10,
  },
  declineButton: {
    backgroundColor: '#dc3545',
    marginHorizontal: 10,
  },
  waitingText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});

export default HomeScreen;