const express = require('express');
const router = express.Router();
const { crearFirma, obtenerFirma, obtenerFirmasPorLiquidacion, revocarFirma } = require('../controllers/firmaDesprendibleController');

// Importar middlewares de autenticación
const { isAdmin } = require('../middleware/auth');

/**
 * @route   POST /api/firmas
 * @desc    Crear una nueva firma digital
 * @access  Usuarios autenticados con permiso de firmar
 */
router.post('/', crearFirma);

/**
 * @route   GET /api/firmas/:id
 * @desc    Obtener una firma específica por ID
 * @access  Usuarios autenticados (propietario) o admin
 */
router.get('/:firmaId', obtenerFirma);

/**
 * @route   GET /api/firmas/liquidacion/:liquidacionId
 * @desc    Obtener todas las firmas de una liquidación específica
 * @access  Usuarios autenticados con acceso a la liquidación
 */
router.get('/liquidacion/:liquidacionId', obtenerFirmasPorLiquidacion);

/**
 * @route   DELETE /api/firmas/:id/revocar
 * @desc    Revocar una firma digital
 * @access  Admin o propietario de la firma
 */
router.delete('/:id/revocar', revocarFirma);

// ========================
// RUTAS ADMINISTRATIVAS
// ========================

/**
 * @route   GET /api/firmas/admin/todas
 * @desc    Obtener todas las firmas del sistema (admin)
 * @access  Solo administradores
 */
router.get('/admin/todas', isAdmin, async (req, res) => {
    try {
        // Esta funcionalidad debería implementarse en el controller
        res.status(501).json({
            success: false,
            message: 'Funcionalidad no implementada aún'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error del servidor',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/firmas/admin/stats
 * @desc    Obtener estadísticas de firmas
 * @access  Solo administradores
 */
router.get('/admin/stats', isAdmin, async (req, res) => {
    try {
        // Esta funcionalidad debería implementarse en el controller
        res.status(501).json({
            success: false,
            message: 'Estadísticas no implementadas aún'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error del servidor',
            error: error.message
        });
    }
});

module.exports = router;