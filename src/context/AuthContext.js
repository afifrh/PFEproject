import React, { createContext, useState, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);

  const storeToken = async (token) => {
    try {
      await AsyncStorage.setItem('userToken', token);
    } catch (error) {
      console.error('Erreur lors du stockage du token:', error);
    }
  };

  const removeToken = async () => {
    try {
      await AsyncStorage.removeItem('userToken');
    } catch (error) {
      console.error('Erreur lors de la suppression du token:', error);
    }
  };

  const signIn = async (token, role) => {
    setLoading(true);
    try {
      await storeToken(token);
      setUser({ token, role });
    } catch (error) {
      console.error('Erreur lors de la connexion:', error);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await removeToken();
      setUser(null);
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
};