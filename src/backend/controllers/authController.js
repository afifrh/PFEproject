const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'votre_secret_jwt';

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Tous les champs sont requis (y compris le rôle)' });
    }

    if (!['technician', 'expert'].includes(role)) {
      return res.status(400).json({ message: 'Rôle invalide' });
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Cet email est déjà utilisé' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer un nouvel utilisateur
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role
    });

    await user.save();

    // Générer le token
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({ token, role: user.role, message: 'Inscription réussie' });
  } catch (error) {
    console.error('Erreur d\'inscription:', error);
    res.status(500).json({ message: error.message || 'Erreur lors de l\'inscription' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Vérifier si l'utilisateur existe
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Vérifier le mot de passe
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Générer le token
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, role: user.role });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la connexion' });
  }
};
// Get all experts
exports.getExperts = async (req, res) => {
  try {
    const experts = await User.find({ role: 'expert' }).select('-password');
    res.json(experts);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Erreur lors de la récupération des experts' });
  }
};

// Get all technicians
exports.getTechnicians = async (req, res) => {
  try {
    const technicians = await User.find({ role: 'technician' }).select('-password');
    res.json(technicians);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Erreur lors de la récupération des techniciens' });
  }
};