// src/controllers/subsystemController.js
const { Subsystem } = require('../models');
const { Op } = require('sequelize');

/**
 * Obtener todos los subsistemas con filtros
 */
const getSubsystems = async (req, res) => {
  try {
    const {
      search,
      sort = 'order_index',
      order = 'ASC',
      is_active,
      required_permission
    } = req.query;

    // Construir condiciones de filtro
    const whereConditions = {};

    if (search) {
      whereConditions[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (is_active !== undefined) {
      whereConditions.is_active = is_active === 'true';
    }

    if (required_permission) {
      whereConditions.required_permission = required_permission;
    }

    const subsystems = await Subsystem.findAll({
      where: whereConditions,
      order: [[sort, order.toUpperCase()]]
    });

    res.json({
      success: true,
      data: subsystems,
      count: subsystems.length
    });

  } catch (error) {
    console.error('Error al obtener subsistemas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Obtener un subsistema por ID
 */
const getSubsystemById = async (req, res) => {
  try {
    const { id } = req.params;

    const subsystem = await Subsystem.findByPk(id);

    if (!subsystem) {
      return res.status(404).json({
        success: false,
        message: 'Subsistema no encontrado'
      });
    }

    res.json({
      success: true,
      data: subsystem
    });

  } catch (error) {
    console.error('Error al obtener subsistema:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Crear un nuevo subsistema
 */
const createSubsystem = async (req, res) => {
  try {
    const {
      name,
      title,
      description,
      url,
      health_endpoint = '/',
      icon_name,
      color_gradient,
      is_active = true,
      required_permission,
      required_roles = [],
      order_index = 0
    } = req.body;

    // Verificar que el nombre no exista
    const existingSubsystem = await Subsystem.findOne({ where: { name } });
    if (existingSubsystem) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un subsistema con ese nombre'
      });
    }

    const subsystem = await Subsystem.create({
      name,
      title,
      description,
      url,
      health_endpoint,
      icon_name,
      color_gradient,
      is_active,
      required_permission,
      required_roles,
      order_index
    });

    res.status(201).json({
      success: true,
      message: 'Subsistema creado exitosamente',
      data: subsystem
    });

  } catch (error) {
    console.error('Error al crear subsistema:', error);
    
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: error.errors.map(err => ({
          field: err.path,
          message: err.message
        }))
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Actualizar un subsistema
 */
const updateSubsystem = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const subsystem = await Subsystem.findByPk(id);

    if (!subsystem) {
      return res.status(404).json({
        success: false,
        message: 'Subsistema no encontrado'
      });
    }

    // Verificar que el nombre no exista en otro registro
    if (updateData.name && updateData.name !== subsystem.name) {
      const existingSubsystem = await Subsystem.findOne({ 
        where: { 
          name: updateData.name,
          id: { [Op.ne]: id }
        } 
      });
      
      if (existingSubsystem) {
        return res.status(400).json({
          success: false,
          message: 'Ya existe un subsistema con ese nombre'
        });
      }
    }

    await subsystem.update(updateData);

    res.json({
      success: true,
      message: 'Subsistema actualizado exitosamente',
      data: subsystem
    });

  } catch (error) {
    console.error('Error al actualizar subsistema:', error);
    
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: error.errors.map(err => ({
          field: err.path,
          message: err.message
        }))
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Eliminar un subsistema
 */
const deleteSubsystem = async (req, res) => {
  try {
    const { id } = req.params;

    const subsystem = await Subsystem.findByPk(id);

    if (!subsystem) {
      return res.status(404).json({
        success: false,
        message: 'Subsistema no encontrado'
      });
    }

    await subsystem.destroy();

    res.json({
      success: true,
      message: 'Subsistema eliminado exitosamente'
    });

  } catch (error) {
    console.error('Error al eliminar subsistema:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Alternar estado activo/inactivo
 */
const toggleSubsystemStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const subsystem = await Subsystem.findByPk(id);

    if (!subsystem) {
      return res.status(404).json({
        success: false,
        message: 'Subsistema no encontrado'
      });
    }

    await subsystem.update({ is_active: !subsystem.is_active });

    res.json({
      success: true,
      message: `Subsistema ${subsystem.is_active ? 'activado' : 'desactivado'} exitosamente`,
      data: subsystem
    });

  } catch (error) {
    console.error('Error al cambiar estado del subsistema:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Obtener subsistemas activos ordenados
 */
const getActiveSubsystems = async (req, res) => {
  try {
    const subsystems = await Subsystem.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']]
    });

    res.json({
      success: true,
      data: subsystems,
      count: subsystems.length
    });

  } catch (error) {
    console.error('Error al obtener subsistemas activos:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

module.exports = {
  getSubsystems,
  getSubsystemById,
  createSubsystem,
  updateSubsystem,
  deleteSubsystem,
  toggleSubsystemStatus,
  getActiveSubsystems
};