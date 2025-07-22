import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, FlatList, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import userService from '../api/userService';
import { jwtDecode } from 'jwt-decode';

const SIGNALING_SERVER_URL = 'http://192.168.1.23:5000';

const HomeScreen = ({ navigation }) => {
  const { signOut, user } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null);
  const [userList, setUserList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [calledExpertId, setCalledExpertId] = useState(null);
  const socketRef = useRef();

  // Initialiser la connexion socket
  useEffect(() => {
    if (user) {
      socketRef.current = io(SIGNALING_SERVER_URL);
      
      socketRef.current.on('connect', () => {
        console.log('Connected to socket server');
        // S'identifier auprès du serveur
        socketRef.current.emit('join', {
          userId: user.token,
          _id: user.token,
          role: user.role
        });
      });

      // Événements pour les experts
      if (user.role === 'expert') {
        socketRef.current.on('incoming-call', (callData) => {
          console.log('Incoming call received:', callData);
          setIncomingCall(callData);
        });
      }

      // Événements pour les techniciens
      if (user.role === 'technician') {
        socketRef.current.on('call-accepted', ({ roomId }) => {
          console.log('Call accepted, joining room:', roomId);
          setCallActive(false);
          navigation.navigate('VideoCallScreen', {
            roomId: roomId,
            expertName: 'Expert',
            isInitiator: true,
          });
        });

        socketRef.current.on('call-declined', () => {
          console.log('Call declined');
          Alert.alert('Appel décliné', 'L\'expert a décliné votre appel');
          setCallActive(false);
          setCalledExpertId(null);
        });

        socketRef.current.on('call-failed', ({ message }) => {
          console.log('Call failed:', message);
          Alert.alert('Échec de l\'appel', message);
          setCallActive(false);
          setCalledExpertId(null);
        });
      }

      // Événements communs
      socketRef.current.on('call-ended', ({ reason }) => {
        console.log('Call ended:', reason);
        setIncomingCall(null);
        setCallActive(false);
        setCalledExpertId(null);
      });

      socketRef.current.on('disconnect', () => {
        console.log('Disconnected from socket server');
      });

      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    }
  }, [user, navigation]);

  // Récupérer la liste des utilisateurs
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

  const handleCall = (expert) => {
  if (callActive) return;

  setCallActive(true);
  setCalledExpertId(expert._id);

  // Decode the JWT token to get the userId
 const decodedToken = jwtDecode(user.token);
const callerId = decodedToken.userId;

  // Create a unique roomId
  const roomId = `call-${callerId}-${expert._id}-${Date.now()}`;

  console.log('Initiating call to expert:', expert._id, 'Room:', roomId);

  // Send the call request
  socketRef.current.emit('call-expert', {
    expertId: expert._id,
    callerName: user.name || user.email || 'Technicien',
    roomId: roomId,
    callerId: callerId, // Use the decoded userId
  });
};

  // Fonction pour accepter un appel (expert)
  const handleAcceptCall = () => {
    if (!incomingCall) return;
    
    console.log('Accepting call:', incomingCall.roomId);
    
    // Accepter l'appel
    socketRef.current.emit('accept-call', { 
      roomId: incomingCall.roomId 
    });
    
    // Naviguer vers l'écran d'appel
    navigation.navigate('VideoCallScreen', { 
      roomId: incomingCall.roomId,
      callerName: incomingCall.callerName || 'Technicien',
      isInitiator: false
    });
    
    setIncomingCall(null);
  };

  // Fonction pour décliner un appel (expert)
  const handleDeclineCall = () => {
    if (!incomingCall) return;
    
    console.log('Declining call:', incomingCall.roomId);
    
    socketRef.current.emit('decline-call', { 
      roomId: incomingCall.roomId 
    });
    
    setIncomingCall(null);
  };

  // Fonction de déconnexion
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

  // Réinitialiser l'état lors du retour sur l'écran
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setCallActive(false);
      setCalledExpertId(null);
    });

    return unsubscribe;
  }, [navigation]);

  // Affichage de l'appel entrant pour les experts
  const renderIncomingCall = () => {
    if (!incomingCall) return null;

    return (
      <View style={styles.incomingCallOverlay}>
        <View style={styles.incomingCallContainer}>
          <Text style={styles.incomingCallTitle}>Appel entrant</Text>
          <Text style={styles.incomingCallText}>
            {incomingCall.callerName} vous appelle
          </Text>
          <View style={styles.callActions}>
            <TouchableOpacity 
              style={[styles.callButton, styles.acceptButton]} 
              onPress={handleAcceptCall}
            >
              <Text style={styles.callButtonText}>Accepter</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.callButton, styles.declineButton]} 
              onPress={handleDeclineCall}
            >
              <Text style={styles.callButtonText}>Décliner</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.welcomeText}>
          Bienvenue, {user?.name || user?.email}
        </Text>
        <Text style={styles.roleText}>
          Rôle: {user?.role === 'expert' ? 'Expert' : 'Technicien'}
        </Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Déconnexion</Text>
        </TouchableOpacity>
      </View>

      {/* Liste des utilisateurs */}
      <View style={styles.userListContainer}>
        <Text style={styles.sectionTitle}>
          {user?.role === 'technician' ? 'Liste des Experts' : 'Liste des Techniciens'}
        </Text>
        
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" />
        ) : (
          <>
            <Text style={styles.usersCount}>
              {user?.role === 'technician'
                ? `Experts disponibles: ${userList.length}`
                : `Techniciens: ${userList.length}`}
            </Text>
            <FlatList
              data={userList}
              keyExtractor={item => item._id}
              renderItem={({ item }) => (
                <View style={styles.userItem}>
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{item.name}</Text>
                    <Text style={styles.userEmail}>{item.email}</Text>
                  </View>
                  {user?.role === 'technician' && (
                    <TouchableOpacity
                      style={[
                        styles.actionButton,
                        callActive && calledExpertId === item._id && styles.activeCallButton,
                        callActive && calledExpertId !== item._id && styles.disabledButton
                      ]}
                      onPress={() => handleCall(item)}
                      disabled={callActive}
                    >
                      <Text style={styles.actionButtonText}>
                        {callActive && calledExpertId === item._id ? 'Appel en cours...' : 'Appeler'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Aucun utilisateur trouvé.</Text>
              }
            />
          </>
        )}
      </View>

      {/* Instructions pour les experts */}
      {user?.role === 'expert' && !incomingCall && (
        <View style={styles.expertInstructions}>
          <Text style={styles.instructionsText}>
            En attente d'appels...
          </Text>
          <Text style={styles.instructionsSubtext}>
            Vous recevrez une notification lors d'un appel entrant
          </Text>
        </View>
      )}

      {/* Overlay pour les appels entrants */}
      {renderIncomingCall()}
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
  userListContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  usersCount: {
    color: '#007AFF',
    marginBottom: 10,
    fontSize: 14,
  },
  userItem: {
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
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  userEmail: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  actionButton: {
    backgroundColor: '#28a745',
    padding: 12,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  activeCallButton: {
    backgroundColor: '#ffc107',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 20,
  },
  expertInstructions: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  instructionsText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  instructionsSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  incomingCallOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  incomingCallContainer: {
    backgroundColor: '#fff',
    padding: 30,
    borderRadius: 15,
    alignItems: 'center',
    minWidth: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  incomingCallTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  incomingCallText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
  },
  callActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  callButton: {
    padding: 15,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
    marginHorizontal: 10,
  },
  acceptButton: {
    backgroundColor: '#28a745',
  },
  declineButton: {
    backgroundColor: '#dc3545',
  },
  callButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default HomeScreen;