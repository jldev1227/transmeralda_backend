// src/routes/subsystemRoutes.js
const express = require('express');
const router = express.Router();
const subsystemController = require('../controllers/subsystemController');
const { protect } = require('../middleware/auth');

// Rutas públicas
router.get('/active', subsystemController.getActiveSubsystems);

// Rutas protegidas
router.use(protect); // Aplicar protección a todas las rutas siguientes

router.get('/', subsystemController.getSubsystems);
router.get('/:id', subsystemController.getSubsystemById);
router.post('/', subsystemController.createSubsystem);
router.put('/:id', subsystemController.updateSubsystem);
router.delete('/:id', subsystemController.deleteSubsystem);
router.patch('/:id/toggle-status', subsystemController.toggleSubsystemStatus);

module.exports = router;