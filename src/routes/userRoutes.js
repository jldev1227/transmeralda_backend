const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { checkPermiso } = require('../middleware/roleCheck');

// Rutas públicas
router.post('/registro', userController.registro);
router.post('/login', userController.login);
router.get('/logout', userController.logout);

// Rutas protegidas
router.get('/perfil', protect, userController.getPerfil);
router.put('/actualizar-perfil', protect, userController.actualizarPerfil);
router.post('/solicitar-cambio-password', userController.solicitarCambioPassword);
router.put('/cambiar-password', protect, userController.cambiarPassword);

// Rutas con permisos específicos
router.get('/flota', protect, checkPermiso('flota'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Tienes acceso al sistema de gestión de flota'
  });
});

router.get('/nomina', protect, checkPermiso('nomina'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Tienes acceso al sistema de liquidación de nómina'
  });
});

module.exports = router;