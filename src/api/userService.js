import axios from 'axios';
import { API_URL } from './config';

const userService = {
  getExperts: async () => {
    try {
      const response = await axios.get(`${API_URL}/auth/experts`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },
  getTechnicians: async () => {
    try {
      const response = await axios.get(`${API_URL}/auth/technicians`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },
};

export default userService;
