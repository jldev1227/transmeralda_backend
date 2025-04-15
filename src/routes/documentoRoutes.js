// routes/documentoRoutes.js

const express = require('express');
const documentoController = require('../controllers/documentoController');
const { protect } = require('../middleware/auth');
const router = express.Router();

/**
 * @route GET /api/vehiculos/:vehiculoId/documentos
 * @description Obtiene todos los documentos asociados a un vehículo
 * @access Private
 */
router.get('/vehiculos/:vehiculoId', protect, async (req, res) => {
  try {
    const { vehiculoId } = req.params;
    
    if (!vehiculoId) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID de vehículo es requerido' 
      });
    }

    const documentos = await documentoController.getDocumentosByVehiculoId(vehiculoId);
    
    return res.status(200).json({
      success: true,
      data: documentos
    });
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al obtener documentos',
      error: error.message
    });
  }
});

/**
 * @route GET /api/documentos/:documentoId
 * @description Obtiene un documento por su ID
 * @access Private
 */
router.get('/documentos/:documentoId', protect, async (req, res) => {
  try {
    const { documentoId } = req.params;
    
    if (!documentoId) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID de documento es requerido' 
      });
    }

    const documento = await documentoController.getDocumentoById(documentoId);
    
    return res.status(200).json({
      success: true,
      data: documento
    });
  } catch (error) {
    console.error('Error al obtener documento:', error);
    
    if (error.message.includes('no encontrado')) {
      return res.status(404).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Error al obtener documento',
      error: error.message
    });
  }
});

/**
 * @route GET /api/documentos/url-firma
 * @description Genera una URL firmada para acceder a un archivo en S3
 * @access Private
 */
router.get('/url-firma', protect, async (req, res) => {

    console.log("Obteniendo firma")
  try {
    const { key, expiresIn } = req.query;
    
    if (!key) {
      return res.status(400).json({ 
        success: false, 
        message: 'La clave S3 es requerida' 
      });
    }

    const expiry = expiresIn ? parseInt(expiresIn) : 900; // Default: 15 minutos
    const signedUrl = await documentoController.generateSignedUrl(key, expiry);
    
    return res.status(200).json({
      success: true,
      url: signedUrl,
      expiresIn: expiry
    });
  } catch (error) {
    console.error('Error al generar URL firmada:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al generar URL firmada',
      error: error.message
    });
  }
});

module.exports = router;