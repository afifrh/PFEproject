const express = require('express');
const router = express.Router();

// Importation du contrôleur (à créer plus tard)
const authController = require('../controllers/authController');

// Définition des routes
router.post('/register', authController.register);


// List all experts
router.get('/experts', authController.getExperts);

// List all technicians
router.get('/technicians', authController.getTechnicians);

router.post('/login', authController.login);

module.exports = router;