// src/routes/recargos.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

// Importar el nuevo controlador
const { RecargoController, uploadMiddleware } = require('../controllers/recargosController');
const controller = new RecargoController();

/**
 * @route   POST /api/recargos
 * @desc    Crear nuevo recargo (con o sin archivo adjunto)
 * @access  Private
 * @body    FormData (con archivo) o JSON (sin archivo)
 */
router.post('/', protect, uploadMiddleware, controller.crear.bind(controller));

/**
 * @route   GET /api/recargos
 * @desc    Obtener recargos con filtros y paginación
 * @access  Private
 * @query   conductor_id, vehiculo_id, empresa_id, mes, año, estado, numero_planilla, page, limit
 */
router.get('/', protect, controller.obtener);

/**
 * @route   GET /api/recargos/:id
 * @desc    Obtener recargo específico por ID con relaciones completas
 * @access  Private
 */
router.get('/:id', protect, controller.obtenerPorId);

/**
 * @route   GET /api/recargos/:id/historial
 * @desc    Obtener historial de cambios de un recargo específico
 * @access  Private
 */
router.get('/:id/historial', protect, async (req, res) => {
  try {
    const { HistorialRecargoPlanilla } = require('../models');
    const { id } = req.params;
    
    const historial = await HistorialRecargoPlanilla.findAll({
      where: { recargo_planilla_id: id },
      include: ['usuario'],
      order: [['fecha_accion', 'DESC']]
    });
    
    res.json({
      success: true,
      data: historial
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error obteniendo historial',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/recargos/stats/resumen
 * @desc    Obtener estadísticas resumidas de recargos
 * @access  Private
 */
router.get('/stats/resumen', protect, async (req, res) => {
  try {
    const { RecargoPlanilla } = require('../models');
    const { Op } = require('sequelize');
    
    const { mes, año } = req.query;
    const where = {};
    
    if (mes) where.mes = parseInt(mes);
    if (año) where.año = parseInt(año);
    
    const stats = await RecargoPlanilla.findAll({
      where,
      attributes: [
        'estado',
        [RecargoPlanilla.sequelize.fn('COUNT', '*'), 'cantidad'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_horas_trabajadas')), 'total_horas'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_hed')), 'total_hed'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_hen')), 'total_hen'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_hefd')), 'total_hefd'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_hefn')), 'total_hefn'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_rn')), 'total_rn'],
        [RecargoPlanilla.sequelize.fn('SUM', RecargoPlanilla.sequelize.col('total_rd')), 'total_rd']
      ],
      group: ['estado']
    });
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   PUT /api/recargos/:id/estado
 * @desc    Cambiar estado de un recargo (aprobar, rechazar, etc.)
 * @access  Private
 * @body    { estado, motivo? }
 */
router.put('/:id/estado', protect, async (req, res) => {
  const transaction = await req.app.locals.sequelize.transaction();
  
  try {
    const { RecargoPlanilla, HistorialRecargoPlanilla } = require('../models');
    const { id } = req.params;
    const { estado, motivo } = req.body;
    
    const estadosValidos = ['borrador', 'activo', 'revisado', 'aprobado', 'anulado'];
    
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Estados válidos: ${estadosValidos.join(', ')}`
      });
    }
    
    const recargo = await RecargoPlanilla.findByPk(id, { transaction });
    
    if (!recargo) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Recargo no encontrado'
      });
    }
    
    const estadoAnterior = recargo.estado;
    
    // Actualizar estado
    await recargo.update({ estado }, {
      user_id: req.user.id,
      transaction
    });
    
    // Registrar en historial
    await HistorialRecargoPlanilla.create({
      recargo_planilla_id: id,
      accion: estado === 'aprobado' ? 'aprobacion' : estado === 'anulado' ? 'rechazo' : 'actualizacion',
      version_anterior: recargo.version - 1,
      version_nueva: recargo.version,
      datos_anteriores: { estado: estadoAnterior },
      datos_nuevos: { estado },
      campos_modificados: ['estado'],
      motivo,
      realizado_por_id: req.user.id,
      ip_usuario: req.ip,
      user_agent: req.get('User-Agent'),
      fecha_accion: new Date()
    }, { transaction });
    
    await transaction.commit();
    
    res.json({
      success: true,
      message: `Estado actualizado a: ${estado}`,
      data: { recargo }
    });
    
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: 'Error actualizando estado',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   DELETE /api/recargos/:id
 * @desc    Eliminar (soft delete) un recargo
 * @access  Private
 */
router.delete('/:id', protect, async (req, res) => {
  const transaction = await req.app.locals.sequelize.transaction();
  
  try {
    const { RecargoPlanilla, HistorialRecargoPlanilla } = require('../models');
    const { id } = req.params;
    const { motivo } = req.body;
    
    const recargo = await RecargoPlanilla.findByPk(id, { transaction });
    
    if (!recargo) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Recargo no encontrado'
      });
    }
    
    // Verificar si se puede eliminar
    if (['aprobado'].includes(recargo.estado)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'No se puede eliminar un recargo aprobado'
      });
    }
    
    // Soft delete
    await recargo.destroy({ transaction });
    
    // Registrar en historial
    await HistorialRecargoPlanilla.create({
      recargo_planilla_id: id,
      accion: 'eliminacion',
      version_anterior: recargo.version,
      version_nueva: recargo.version,
      datos_anteriores: recargo.toJSON(),
      motivo: motivo || 'Eliminación del recargo',
      realizado_por_id: req.user.id,
      ip_usuario: req.ip,
      user_agent: req.get('User-Agent'),
      fecha_accion: new Date()
    }, { transaction });
    
    await transaction.commit();
    
    res.json({
      success: true,
      message: 'Recargo eliminado exitosamente'
    });
    
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: 'Error eliminando recargo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==========================================
// RUTAS PARA GESTIÓN DE ARCHIVOS
// ==========================================

/**
 * @route   GET /api/recargos/:id/archivo
 * @desc    Descargar archivo adjunto de un recargo
 * @access  Private
 */
router.get('/:id/archivo', protect, async (req, res) => {
  try {
    const { RecargoPlanilla } = require('../models');
    const { id } = req.params;
    
    const recargo = await RecargoPlanilla.findByPk(id);
    
    if (!recargo || !recargo.archivo_planilla_url) {
      return res.status(404).json({
        success: false,
        message: 'Archivo no encontrado'
      });
    }
    
    const path = require('path');
    const fs = require('fs');
    const filePath = path.join(__dirname, '../../', recargo.archivo_planilla_url);
    
    // Verificar que el archivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Archivo físico no encontrado'
      });
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${recargo.archivo_planilla_nombre}"`);
    res.setHeader('Content-Type', recargo.archivo_planilla_tipo);
    
    res.sendFile(filePath);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error descargando archivo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;