// controllers/liquidacionController.js
const { LiquidacionServicio, Servicio, ServicioLiquidacion, Municipio, sequelize, User, Vehiculo, Conductor, Empresa } = require('../models');
const { Op } = require('sequelize');

// Crear una nueva liquidación
const crearLiquidacion = async (req, res) => {
  let transaction;

  try {
    // Iniciar transacción
    transaction = await sequelize.transaction();

    // Extraer datos
    const {
      consecutivo = '',
      fecha_liquidacion = '',
      servicios = [],
      observaciones = ''
    } = req.body;

    // Validar que hay servicios para liquidar
    if (!servicios || !Array.isArray(servicios) || servicios.length === 0) {
      return res.status(400).json({ error: 'Debe seleccionar al menos un servicio para liquidar' });
    }

    // Extraer IDs
    const servicios_ids = servicios.map(s => s.id).filter(Boolean);
    console.log(servicios_ids);

    if (servicios_ids.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron IDs de servicios válidos' });
    }

    // Obtener servicios
    const serviciosDB = await Servicio.findAll({
      where: {
        id: servicios_ids
      },
      transaction
    });

    if (serviciosDB.length !== servicios_ids.length) {
      throw new Error('Algunos servicios no existen o no están en estado correcto');
    }

    // Calcular valor total
    const valorTotal = servicios.reduce((total, servicio) =>
      total + (parseFloat(servicio.valor) || 0), 0);

    // Crear liquidación
    const liquidacion = await LiquidacionServicio.create({
      consecutivo,
      fecha_liquidacion,
      valor_total: valorTotal,
      user_id: req.user.id,
      estado: 'liquidado',
      observaciones
    }, { transaction });

    // Crear relaciones
    const servicioLiquidaciones = [];

    for (const servicioData of servicios) {
      if (!servicioData || !servicioData.id) continue;

      servicioLiquidaciones.push({
        servicio_id: servicioData.id,
        liquidacion_id: liquidacion.id,
        valor_liquidado: parseFloat(servicioData.valor) || 0
      });
    }

    if (servicioLiquidaciones.length === 0) {
      throw new Error('No se pudieron crear relaciones para ningún servicio');
    }

    await ServicioLiquidacion.bulkCreate(servicioLiquidaciones, { transaction });

    // Actualizar servicios
    for (const servicioDB of serviciosDB) {
      const servicioData = servicios.find(s => s.id === servicioDB.id);
      if (!servicioData) continue;

      await servicioDB.update(
        {
          valor: parseFloat(servicioData.valor) || servicioDB.valor,
          estado: 'liquidado'
        },
        {
          transaction,
          individualHooks: true,
          user_id: req.user.id
        }
      );
    }

    // Hacer commit de la transacción
    await transaction.commit();
    transaction = null; // Importante: marcar como nula después del commit

    // Obtener liquidación completa
    const liquidacionCompleta = await LiquidacionServicio.findByPk(liquidacion.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'nombre', 'correo']
        },
        {
          model: Servicio,
          as: 'servicios',
          through: { attributes: ['valor_liquidado'] },
          include: [
            {
              model: Empresa,  // Quitado el prefijo sequelize
              as: 'cliente'
            }
          ]
        }
      ]
    });

    return res.status(201).json(liquidacionCompleta);

  } catch (error) {
    console.error('Error al crear liquidación:', error);

    // Solo hacer rollback si la transacción existe y no ha sido completada
    if (transaction) await transaction.rollback();

    return res.status(500).json({
      error: 'Error al crear la liquidación',
      details: error.message
    });
  }
};

// Obtener todas las liquidaciones
const obtenerLiquidaciones = async (req, res) => {
  try {
    const { page = 1, limit = 10, estado, desde, hasta, search } = req.query;
    const offset = (page - 1) * limit;

    // Construir condiciones de filtrado
    const where = {};
    if (estado) where.estado = estado;
    if (desde && hasta) {
      where.fecha_liquidacion = {
        [Op.between]: [new Date(desde), new Date(hasta)]
      };
    }

    // Añadir filtro de búsqueda
    if (search && search.trim() !== '') {
      where[Op.or] = [
        { consecutivo: { [Op.iLike]: `%${search}%` } },
        // Si necesitas buscar por otros campos, agrégalos aquí
        // Por ejemplo:
        // '$servicios.numero_planilla$': { [Op.iLike]: `%${search}%` },
        // '$user.nombre$': { [Op.iLike]: `%${search}%` }
      ];
    }

    // Corrección en la consulta
    const liquidaciones = await LiquidacionServicio.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'nombre', 'correo']
        },
        {
          model: Servicio,
          as: 'servicios',
          through: { attributes: ['valor_liquidado'] },
          include: [
            {
              model: Empresa,  // Quitado el prefijo sequelize
              as: 'cliente'
            }
          ]
        }
      ],
      order: [['fecha_liquidacion', 'DESC']]
    });

    return res.status(200).json({
      total: liquidaciones.count,
      pages: Math.ceil(liquidaciones.count / limit),
      currentPage: parseInt(page),
      liquidaciones: liquidaciones.rows
    });

  } catch (error) {
    console.error('Error al obtener liquidaciones:', error);
    return res.status(500).json({ error: 'Error al obtener liquidaciones', details: error.message });
  }
};

// Obtener una liquidación por ID
const obtenerLiquidacionPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const liquidacion = await LiquidacionServicio.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',  // Cambiado a 'user' para ser consistente con el otro método
          attributes: ['id', 'nombre', 'correo']
        },
        {
          model: Servicio,
          as: 'servicios',
          through: { attributes: ['valor_liquidado'] },  // Cambiado a 'valor_liquidado' para ser consistente
          include: [
            {
              model: Municipio,  // Quitado el prefijo sequelize
              as: 'origen'
            },
            {
              model: Municipio,  // Quitado el prefijo sequelize
              as: 'destino'
            },
            {
              model: Conductor,  // Quitado el prefijo sequelize
              as: 'conductor'
            },
            {
              model: Vehiculo,  // Quitado el prefijo sequelize
              as: 'vehiculo'
            },
            {
              model: Empresa,  // Quitado el prefijo sequelize
              as: 'cliente'
            }
          ]
        }
      ]
    });

    if (!liquidacion) {
      return res.status(404).json({ error: 'Liquidación no encontrada' });
    }

    return res.status(200).json(liquidacion);

  } catch (error) {
    console.error('Error al obtener liquidación:', error);
    return res.status(500).json({ error: 'Error al obtener liquidación', details: error.message });
  }
};

// Actualizar una liquidación
const actualizarLiquidacion = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { estado, observaciones } = req.body;

    // Verificar que la liquidación existe
    const liquidacion = await LiquidacionServicio.findByPk(id, { transaction });

    if (!liquidacion) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Liquidación no encontrada' });
    }

    // Verificar que el estado sea válido para actualizar
    if (liquidacion.estado === 'anulada') {
      await transaction.rollback();
      return res.status(400).json({ error: 'No se puede actualizar una liquidación anulada' });
    }

    // Actualizar la liquidación
    await liquidacion.update({
      estado: estado || liquidacion.estado,
      observaciones: observaciones !== undefined ? observaciones : liquidacion.observaciones
    }, {
      transaction,
      individualHooks: true,
      user_id: req.user.id
    });

    await transaction.commit();

    return res.status(200).json({ message: 'Liquidación actualizada correctamente', liquidacion });

  } catch (error) {
    await transaction.rollback();
    console.error('Error al actualizar liquidación:', error);
    return res.status(500).json({ error: 'Error al actualizar liquidación' });
  }
};

// Anular una liquidación
const anularLiquidacion = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    // Verificar que la liquidación existe
    const liquidacion = await LiquidacionServicio.findByPk(id, {
      include: [
        {
          model: Servicio,
          as: 'servicios',
          through: { attributes: ['servicio_id'] },
          include: [
            {
              model: Empresa,  // Quitado el prefijo sequelize
              as: 'cliente'
            }
          ]
        }
      ],
      transaction
    });

    if (!liquidacion) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Liquidación no encontrada' });
    }

    // Verificar que no esté ya anulada
    if (liquidacion.estado === 'anulada') {
      await transaction.rollback();
      return res.status(400).json({ error: 'La liquidación ya está anulada' });
    }

    // Obtener IDs de servicios relacionados
    const serviciosIds = liquidacion.servicios.map(s => s.id);

    // Actualizar estado de la liquidación
    await liquidacion.update(
      { estado: 'anulada' },
      {
        transaction,
        individualHooks: true,
        user_id: req.user.id
      }
    );

    // Restaurar estado de los servicios
    if (serviciosIds.length > 0) {
      await Servicio.update(
        { estado: 'planilla_asignada' }, // Volver al estado anterior
        {
          where: { id: serviciosIds },
          transaction,
          individualHooks: true,
          user_id: req.user.id
        }
      );
    }

    await transaction.commit();

    return res.status(200).json({ message: 'Liquidación anulada correctamente' });

  } catch (error) {
    await transaction.rollback();
    console.error('Error al anular liquidación:', error);
    return res.status(500).json({ error: 'Error al anular liquidación' });
  }
};

// Aprobar una liquidación
const aprobarLiquidacion = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    // Verificar que la liquidación existe
    const liquidacion = await LiquidacionServicio.findByPk(id, {
      include: [
        {
          model: Servicio,
          as: 'servicios',
          through: { attributes: ['servicio_id'] },
          include: [
            {
              model: Empresa,  // Quitado el prefijo sequelize
              as: 'cliente'
            }
          ]
        }
      ],
      transaction
    });

    if (!liquidacion) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Liquidación no encontrada' });
    }

    // Verificar que no esté ya anulada
    if (liquidacion.estado === 'aprobado') {
      await transaction.rollback();
      return res.status(400).json({ error: 'La liquidación ya está aprobada' });
    }

    // Obtener IDs de servicios relacionados
    const serviciosIds = liquidacion.servicios.map(s => s.id);

    // Actualizar estado de la liquidación
    await liquidacion.update(
      { estado: 'aprobado' },
      {
        transaction,
        individualHooks: true,
        user_id: req.user.id
      }
    );

    await transaction.commit();

    return res.status(200).json({ message: 'Liquidación aprobada correctamente' });

  } catch (error) {
    await transaction.rollback();
    console.error('Error al anular liquidación:', error);
    return res.status(500).json({ error: 'Error al anular liquidación' });
  }
};

// Obtener servicios disponibles para liquidar
const obtenerServiciosParaLiquidar = async (req, res) => {
  try {
    const { cliente_id, fecha_inicio, fecha_fin } = req.query;

    // Construir condiciones de filtrado
    const where = {
      estado: 'planilla_asignada',
      numero_planilla: { [Op.not]: null }
    };

    if (cliente_id) where.cliente_id = cliente_id;

    if (fecha_inicio && fecha_fin) {
      where.fecha_realizacion = {
        [Op.between]: [new Date(fecha_inicio), new Date(fecha_fin)]
      };
    }

    const servicios = await Servicio.findAll({
      where,
      include: [
        { model: sequelize.Municipio, as: 'origen' },
        { model: sequelize.Municipio, as: 'destino' },
        { model: sequelize.Conductor, as: 'conductor' },
        { model: sequelize.Vehiculo, as: 'vehiculo' },
        { model: sequelize.Empresa, as: 'cliente' }
      ],
      order: [['fecha_realizacion', 'DESC']]
    });

    return res.status(200).json(servicios);

  } catch (error) {
    console.error('Error al obtener servicios para liquidar:', error);
    return res.status(500).json({ error: 'Error al obtener servicios para liquidar' });
  }
};

// Reporte de liquidaciones por período
const reporteLiquidacionesPorPeriodo = async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ error: 'Debe proporcionar fechas de inicio y fin para el reporte' });
    }

    const liquidaciones = await LiquidacionServicio.findAll({
      where: {
        fecha_liquidacion: {
          [Op.between]: [new Date(inicio), new Date(fin)]
        },
        estado: { [Op.ne]: 'anulada' }
      },
      include: [
        {
          model: Servicio,
          as: 'servicios',
          through: { attributes: ['valor'] },
          include: [{ model: sequelize.Empresa, as: 'cliente' }]
        }
      ],
      order: [['fecha_liquidacion', 'ASC']]
    });

    // Procesar datos para el reporte
    const resumen = {
      total_liquidaciones: liquidaciones.length,
      valor_total: liquidaciones.reduce((sum, liq) => sum + parseFloat(liq.valor_total.toString()), 0),
      por_cliente: {}
    };

    // Agrupar por cliente
    liquidaciones.forEach(liquidacion => {
      liquidacion.servicios.forEach(servicio => {
        const clienteId = servicio.cliente.id;
        const clienteNombre = servicio.cliente.nombre;

        if (!resumen.por_cliente[clienteId]) {
          resumen.por_cliente[clienteId] = {
            nombre: clienteNombre,
            cantidad_servicios: 0,
            valor_total: 0
          };
        }

        resumen.por_cliente[clienteId].cantidad_servicios++;
        const servicioLiquidacion = servicio.ServicioLiquidacion;
        if (servicioLiquidacion && servicioLiquidacion.valor) {
          resumen.por_cliente[clienteId].valor_total += parseFloat(servicioLiquidacion.valor.toString());
        }
      });
    });

    return res.status(200).json({
      periodo: { inicio, fin },
      resumen,
      liquidaciones
    });

  } catch (error) {
    console.error('Error al generar reporte de liquidaciones:', error);
    return res.status(500).json({ error: 'Error al generar reporte de liquidaciones' });
  }
};

// Reporte de liquidaciones por cliente
const reporteLiquidacionesPorCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const { inicio, fin } = req.query;

    const where = {
      estado: { [Op.ne]: 'anulada' }
    };

    if (inicio && fin) {
      where.fecha_liquidacion = {
        [Op.between]: [new Date(inicio), new Date(fin)]
      };
    }

    // Obtener liquidaciones que incluyan servicios del cliente especificado
    const liquidaciones = await LiquidacionServicio.findAll({
      where,
      include: [
        {
          model: Servicio,
          as: 'servicios',
          required: true, // INNER JOIN
          through: { attributes: ['valor'] },
          where: { cliente_id: clienteId },
          include: [
            { model: sequelize.Municipio, as: 'origen' },
            { model: sequelize.Municipio, as: 'destino' },
            { model: sequelize.Empresa, as: 'cliente' }
          ]
        }
      ],
      order: [['fecha_liquidacion', 'DESC']]
    });

    // Obtener información del cliente
    const cliente = await sequelize.Empresa.findByPk(clienteId);

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Calcular totales
    const totalServicios = liquidaciones.reduce((total, liq) => total + liq.servicios.length, 0);
    const valorTotal = liquidaciones.reduce((total, liq) => {
      return total + liq.servicios.reduce((sum, serv) => {
        return sum + parseFloat(serv.ServicioLiquidacion.valor.toString());
      }, 0);
    }, 0);

    return res.status(200).json({
      cliente,
      resumen: {
        total_liquidaciones: liquidaciones.length,
        total_servicios: totalServicios,
        valor_total: valorTotal
      },
      liquidaciones
    });

  } catch (error) {
    console.error('Error al generar reporte por cliente:', error);
    return res.status(500).json({ error: 'Error al generar reporte por cliente' });
  }
};

module.exports = {
  crearLiquidacion,
  obtenerLiquidaciones,
  obtenerLiquidacionPorId,
  actualizarLiquidacion,
  anularLiquidacion,
  aprobarLiquidacion,
  obtenerServiciosParaLiquidar,
  reporteLiquidacionesPorPeriodo,
  reporteLiquidacionesPorCliente
};