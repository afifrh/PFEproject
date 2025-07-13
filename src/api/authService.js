import axios from 'axios';
import { API_URL } from './config';

const authService = {
  login: async (email, password) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login`, {
        email,
        password,
      });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  register: async (name, email, password, role) => {
    try {
      const response = await axios.post(`${API_URL}/auth/register`, {
        name,
        email,
        password,
        role,
      });
      console.log('Réponse du serveur:', response.data);
      return response.data;
    } catch (error) {
      console.error('Erreur dans authService.register:', error.response?.data || error);
      throw error.response?.data || { message: 'Erreur de connexion au serveur' };
    }
  },
};

export default authService;