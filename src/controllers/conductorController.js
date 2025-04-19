const { Conductor, Vehiculo } = require('../models');
const { Op } = require('sequelize');

exports.crearConductor = async (req, res) => {
  try {
    const nuevoConductor = await Conductor.create(req.body);
    res.status(201).json({
      success: true,
      message: 'Conductor creado exitosamente',
      data: nuevoConductor
    });
  } catch (error) {
    console.error('Error al crear conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.obtenerConductores = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      estado, 
      nombre, 
      cargo 
    } = req.query;

    const whereClause = {};

    if (estado) whereClause.estado = estado;
    if (nombre) whereClause.nombre = { [Op.iLike]: `%${nombre}%` };
    if (cargo) whereClause.cargo = cargo;

    const offset = (page - 1) * limit;

    const { count, rows } = await Conductor.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [
        { model: Vehiculo, as: 'vehiculos', attributes: ['id', 'placa'] }
      ]
    });

    res.status(200).json({
      success: true,
      count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      data: rows
    });
  } catch (error) {
    console.error('Error al obtener conductores:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener conductores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.obtenerConductorPorId = async (req, res) => {
  try {
    const conductor = await Conductor.findByPk(req.params.id, {
      include: [
        { model: Vehiculo, as: 'vehiculos', attributes: ['id', 'placa'] }
      ]
    });

    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      data: conductor
    });
  } catch (error) {
    console.error('Error al obtener conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.actualizarConductor = async (req, res) => {
  try {
    const [updated] = await Conductor.update(req.body, {
      where: { id: req.params.id }
    });

    if (updated === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    const conductorActualizado = await Conductor.findByPk(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Conductor actualizado exitosamente',
      data: conductorActualizado
    });
  } catch (error) {
    console.error('Error al actualizar conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.eliminarConductor = async (req, res) => {
  try {
    const eliminado = await Conductor.destroy({
      where: { id: req.params.id }
    });

    if (eliminado === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Conductor eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.obtenerConductoresBasicos = async (req, res) => {
  try {
    const conductores = await Conductor.findAll({
      attributes: ['id', 'nombre', 'apellido', "numero_identificacion"]
    });

    res.status(200).json({
      success: true,
      count: conductores.length,
      data: conductores
    });
  } catch (error) {
    console.error('Error al obtener conductores básicos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener conductores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.asignarConductorAVehiculo = async (req, res) => {
  try {
    const { conductorId, vehiculoId } = req.body;

    // Verificar que el conductor existe
    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    // Verificar que el vehículo existe
    const vehiculo = await Vehiculo.findByPk(vehiculoId);
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    // Actualizar el vehículo con el ID del conductor
    await Vehiculo.update(
      { conductor_id: conductorId },
      { where: { id: vehiculoId } }
    );

    const vehiculoActualizado = await Vehiculo.findByPk(vehiculoId, {
      include: [{ model: Conductor, as: 'conductor' }]
    });

    res.status(200).json({
      success: true,
      message: 'Conductor asignado al vehículo exitosamente',
      data: vehiculoActualizado
    });
  } catch (error) {
    console.error('Error al asignar conductor a vehículo:', error);
    res.status(500).json({
      success: false,
      message: 'Error al asignar conductor a vehículo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};