const { ServicioHistorico, Servicio, User } = require('../models');

/**
 * Obtener el historial de cambios de un servicio específico
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 */
exports.obtenerHistoricoPorServicioId = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar primero que el servicio existe
    const servicioExiste = await Servicio.findByPk(id);
    if (!servicioExiste) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Obtener todos los registros históricos para este servicio
    const historicos = await ServicioHistorico.findAll({
      where: { servicio_id: id },
      include: [
        {
          model: User,
          as: 'usuario',
          attributes: ['id', 'nombre', 'correo', 'role']
        }
      ],
      order: [['fecha_modificacion', 'DESC']] // Ordenar por fecha de modificación (más reciente primero)
    });

    return res.status(200).json({
      success: true,
      data: historicos,
      total: historicos.length
    });
  } catch (error) {
    console.error('Error al obtener historial de servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener historial de servicio',
      error: error.message
    });
  }
};

/**
 * Obtener un registro histórico específico por su ID
 */
exports.obtenerHistoricoPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const historico = await ServicioHistorico.findByPk(id, {
      include: [
        {
          model: User,
          as: 'usuario',
          attributes: ['id', 'nombre', 'correo', 'role']
        },
        {
          model: Servicio,
          as: 'servicio',
          attributes: ['id', 'origen_id', 'destino_id', 'estado', 'proposito_servicio', 'fecha_solicitud', 'fecha_realizacion']
        }
      ]
    });

    if (!historico) {
      return res.status(404).json({
        success: false,
        message: 'Registro histórico no encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      data: historico
    });
  } catch (error) {
    console.error('Error al obtener registro histórico:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener registro histórico',
      error: error.message
    });
  }
};

/**
 * Obtener todos los registros históricos con filtros opcionales
 */
exports.obtenerTodosHistoricos = async (req, res) => {
  try {
    const { servicio_id, usuario_id, tipo_operacion, campo_modificado, desde, hasta, limit = 50, page = 1 } = req.query;
    
    // Calcular el offset para la paginación
    const offset = (page - 1) * limit;
    
    // Construir condiciones de búsqueda
    const where = {};
    
    if (servicio_id) where.servicio_id = servicio_id;
    if (usuario_id) where.usuario_id = usuario_id;
    if (tipo_operacion) where.tipo_operacion = tipo_operacion;
    if (campo_modificado) where.campo_modificado = campo_modificado;
    
    // Filtro de rango de fechas
    if (desde || hasta) {
      where.fecha_modificacion = {};
      const { Op } = require('sequelize');
      
      if (desde) {
        where.fecha_modificacion[Op.gte] = new Date(desde);
      }
      
      if (hasta) {
        where.fecha_modificacion[Op.lte] = new Date(hasta);
      }
    }
    
    // Obtener los registros históricos con paginación
    const historicos = await ServicioHistorico.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'email', 'role']
        },
        {
          model: Servicio,
          as: 'servicio',
          attributes: ['id', 'origen_id', 'destino_id', 'estado', 'proposito_servicio', 'fecha_solicitud', 'fecha_realizacion']
        }
      ],
      order: [['fecha_modificacion', 'DESC']],
      limit: parseInt(limit),
      offset
    });
    
    return res.status(200).json({
      success: true,
      data: historicos.rows,
      meta: {
        total: historicos.count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(historicos.count / limit)
      }
    });
  } catch (error) {
    console.error('Error al obtener registros históricos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener registros históricos',
      error: error.message
    });
  }
};