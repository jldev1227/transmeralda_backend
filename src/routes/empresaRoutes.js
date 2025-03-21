// routes/empresaRoutes.js
const express = require('express');
const router = express.Router();
const empresaController = require('../controllers/empresaController');
const { protect } = require('../middleware/auth');

// Middleware de autenticación para todas las rutas
// Descomenta si tienes un sistema de autenticación implementado
// router.use(authenticateToken);

/**
 * @route   GET /api/empresas
 * @desc    Obtener todas las empresas
 * @access  Privado
 */
router.get('/', protect, empresaController.getEmpresas);

/**
 * @route   GET /api/empresas/basicos
 * @desc    Obtener datos básicos de todas las empresas (id, NIT, Nombre)
 * @access  Privado
 */
router.get('/basicos', protect, empresaController.getEmpresasBasicos);

/**
 * @route   GET /api/empresas/search
 * @desc    Buscar empresas por término
 * @access  Privado
 */
router.get('/search', protect, empresaController.searchEmpresas);

/**
 * @route   GET /api/empresas/:id
 * @desc    Obtener empresa por ID
 * @access  Privado
 */
router.get('/:id', protect, empresaController.getEmpresaById);

/**
 * @route   POST /api/empresas
 * @desc    Crear nueva empresa
 * @access  Privado
 */
router.post('/', protect, empresaController.createEmpresa);

/**
 * @route   PUT /api/empresas/:id
 * @desc    Actualizar empresa
 * @access  Privado
 */
router.put('/:id', protect, empresaController.updateEmpresa);

/**
 * @route   DELETE /api/empresas/:id
 * @desc    Eliminar empresa (soft delete)
 * @access  Privado
 */
router.delete('/:id', protect, empresaController.deleteEmpresa);

/**
 * @route   POST /api/empresas/:id/restore
 * @desc    Restaurar empresa eliminada
 * @access  Privado
 */
router.post('/:id/restore', protect, empresaController.restoreEmpresa);

module.exports = router;