const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');


router.get('/', userController.getAllUsers);

// Rutas públicas
router.post('/registro', userController.registro);
router.post('/login', userController.login);
router.get('/logout', userController.logout);

// Rutas protegidas
router.get('/perfil', protect, userController.getPerfil);
router.put('/actualizar-perfil', protect, userController.actualizarPerfil);
router.post('/solicitar-cambio-password', userController.solicitarCambioPassword);
router.put('/cambiar-password', protect, userController.cambiarPassword);


module.exports = router;