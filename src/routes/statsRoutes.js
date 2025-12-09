// src/routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

/**
 * @route   GET /api/stats/dashboard
 * @desc    Obtener estadísticas generales del dashboard
 * @access  Private
 */
router.get('/dashboard', protect, async (req, res) => {
  try {
    const { 
      Vehiculo, 
      Conductor, 
      Empresa, 
      RecargoPlanilla,
      User 
    } = require('../models');

    // Realizar todas las consultas en paralelo
    const [
      totalVehiculos,
      totalConductores,
      totalEmpresas,
      totalRecargos,
      totalUsuarios,
      vehiculosActivos,
      recargosActivos,
      recargosPendientes
    ] = await Promise.all([
      Vehiculo.count(),
      Conductor.count(),
      Empresa.count(),
      RecargoPlanilla.count(),
      User.count(),
      Vehiculo.count({ where: { estado: 'activo' } }),
      RecargoPlanilla.count({ where: { estado: 'activo' } }),
      RecargoPlanilla.count({ where: { estado: 'borrador' } })
    ]);

    res.json({
      success: true,
      data: {
        vehiculos: {
          total: totalVehiculos,
          activos: vehiculosActivos
        },
        conductores: {
          total: totalConductores
        },
        empresas: {
          total: totalEmpresas
        },
        recargos: {
          total: totalRecargos,
          activos: recargosActivos,
          pendientes: recargosPendientes
        },
        usuarios: {
          total: totalUsuarios
        }
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas del dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/stats/vehiculos
 * @desc    Obtener estadísticas detalladas de vehículos
 * @access  Private
 */
router.get('/vehiculos', protect, async (req, res) => {
  try {
    const { Vehiculo } = require('../models');
    const { Op } = require('sequelize');

    const [
      total,
      activos,
      inactivos,
      enMantenimiento,
      porTipo
    ] = await Promise.all([
      Vehiculo.count(),
      Vehiculo.count({ where: { estado: 'activo' } }),
      Vehiculo.count({ where: { estado: 'inactivo' } }),
      Vehiculo.count({ where: { estado: 'mantenimiento' } }),
      Vehiculo.findAll({
        attributes: [
          'tipo',
          [Vehiculo.sequelize.fn('COUNT', '*'), 'cantidad']
        ],
        group: ['tipo']
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        activos,
        inactivos,
        enMantenimiento,
        porTipo
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de vehículos:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de vehículos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/stats/conductores
 * @desc    Obtener estadísticas detalladas de conductores
 * @access  Private
 */
router.get('/conductores', protect, async (req, res) => {
  try {
    const { Conductor } = require('../models');

    const [
      total,
      conVehiculo,
      sinVehiculo
    ] = await Promise.all([
      Conductor.count(),
      Conductor.count({ where: { vehiculo_id: { [require('sequelize').Op.ne]: null } } }),
      Conductor.count({ where: { vehiculo_id: null } })
    ]);

    res.json({
      success: true,
      data: {
        total,
        conVehiculo,
        sinVehiculo
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de conductores:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de conductores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/stats/recargos
 * @desc    Obtener estadísticas detalladas de recargos/planillas
 * @access  Private
 */
router.get('/recargos', protect, async (req, res) => {
  try {
    const { RecargoPlanilla } = require('../models');

    const [
      total,
      porEstado,
      mesActual
    ] = await Promise.all([
      RecargoPlanilla.count(),
      RecargoPlanilla.findAll({
        attributes: [
          'estado',
          [RecargoPlanilla.sequelize.fn('COUNT', '*'), 'cantidad']
        ],
        group: ['estado']
      }),
      RecargoPlanilla.count({
        where: {
          mes: new Date().getMonth() + 1,
          año: new Date().getFullYear()
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        porEstado,
        mesActual
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de recargos:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de recargos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
