const { Conductor, Vehiculo } = require('../models');
const { Op, ValidationError } = require('sequelize');

exports.crearConductor = async (req, res) => {
  try {
    const datos = req.body;

    // Determinar si es un conductor de planta basado en los campos presentes
    const esPlanta = !!(
      datos.salario_base &&
      datos.fecha_ingreso &&
      datos.email
    );

    // Validar campos obligatorios para todos los conductores
    const camposBasicosRequeridos = [
      'nombre',
      'apellido',
      'tipo_identificacion',
      'numero_identificacion',
      'telefono'
    ];

    // Validar campos obligatorios para conductores de planta
    const camposPlantaRequeridos = [
      'email',
      'salario_base',
      'fecha_ingreso'
    ];

    // Recopilar errores de validación
    const errores = [];

    // Verificar campos básicos requeridos
    camposBasicosRequeridos.forEach(campo => {
      if (!datos[campo]) {
        errores.push({
          campo,
          mensaje: `El campo ${campo} es obligatorio`
        });
      }
    });

    // Verificar campos de planta si es conductor de planta
    if (esPlanta) {
      camposPlantaRequeridos.forEach(campo => {
        if (!datos[campo]) {
          errores.push({
            campo,
            mensaje: `El campo ${campo} es obligatorio para conductores de planta`
          });
        }
      });

      // Validaciones adicionales para campos específicos
      if (datos.email && !/^\S+@\S+\.\S+$/.test(datos.email)) {
        errores.push({
          campo: 'email',
          mensaje: 'El formato del correo electrónico no es válido'
        });
      }

      if (datos.password && datos.password.length < 8) {
        errores.push({
          campo: 'password',
          mensaje: 'La contraseña debe tener al menos 8 caracteres'
        });
      }

      if (datos.salario_base && isNaN(parseFloat(datos.salario_base))) {
        errores.push({
          campo: 'salario_base',
          mensaje: 'El salario base debe ser un valor numérico'
        });
      }

      if (datos.fecha_ingreso && !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_ingreso)) {
        errores.push({
          campo: 'fecha_ingreso',
          mensaje: 'La fecha de ingreso debe tener el formato YYYY-MM-DD'
        });
      }
    } else {
      datos.salario_base = datos.salario_base || 0;
      datos.fecha_ingreso = datos.fecha_ingreso || new Date().toISOString().split('T')[0];
      datos.cargo = datos.cargo || 'CONDUCTOR EXTERNO';

      // Asignar tipo de contrato para conductores no de planta
      datos.tipo_contrato = datos.tipo_contrato || 'PRESTACION';
    }

    // Si hay errores de validación, retornar error
    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores
      });
    }

    // Asignar permisos predeterminados según el tipo de conductor
    datos.permisos = datos.permisos || {
      verViajes: true,
      verMantenimientos: esPlanta,
      verDocumentos: true,
      actualizarPerfil: esPlanta
    };

    // Asignar el creador si está disponible en la petición
    if (req.user && req.user.id) {
      datos.creado_por_id = req.user.id;
    }

    // Crear el conductor
    const nuevoConductor = await Conductor.create(datos);

    // Emitir evento para todos los clientes conectados
    const emitConductorEvent = req.app.get('emitConductorEvent');
    if (emitConductorEvent) {
      emitConductorEvent('conductor:creado', nuevoConductor);
    }

    // Retornar respuesta exitosa
    res.status(201).json({
      success: true,
      message: `Conductor ${esPlanta ? 'de planta' : 'externo'} creado exitosamente`,
      data: nuevoConductor
    });

  } catch (error) {
    console.error('Error al crear conductor:', error);

    // Manejar errores de validación de Sequelize
    if (error instanceof ValidationError) {
      const erroresValidacion = error.errors.map(err => ({
        campo: err.path,
        mensaje: err.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores: erroresValidacion
      });
    }

    // Manejar error de clave única (como email o número de identificación duplicado)
    if (error.name === 'SequelizeUniqueConstraintError') {
      const camposDuplicados = error.errors.map(err => ({
        campo: err.path,
        mensaje: `El ${err.path} ya está en uso por otro conductor`
      }));

      return res.status(409).json({
        success: false,
        message: 'Error de duplicidad',
        errores: camposDuplicados
      });
    }

    // Manejar otros errores
    res.status(500).json({
      success: false,
      message: 'Error al crear conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor'
    });
  }
};

exports.obtenerConductores = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      sort = 'createdAt',
      order = 'DESC'
    } = req.query;

    const sequelizeOrder = order;

    const whereClause = {};

    // Procesamiento de búsqueda general (busca en varios campos)
    if (search) {
      whereClause[Op.or] = [
        { nombre: { [Op.iLike]: `%${search}%` } },
        { apellido: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { numero_identificacion: { [Op.iLike]: `%${search}%` } },
        { telefono: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Procesamiento de filtro por estado (puede ser múltiple)
    if (req.query.estado) {
      const estados = req.query.estado.split(',');
      whereClause.estado = { [Op.in]: estados };
    }

    // Procesamiento de filtro por sede de trabajo (puede ser múltiple)
    if (req.query.sede_trabajo) {
      const sedes = req.query.sede_trabajo.split(',');
      whereClause.sede_trabajo = { [Op.in]: sedes };
    }

    // Procesamiento de filtro por tipo de identificación (puede ser múltiple)
    if (req.query.tipo_identificacion) {
      const tiposId = req.query.tipo_identificacion.split(',');
      whereClause.tipo_identificacion = { [Op.in]: tiposId };
    }

    // Procesamiento de filtro por tipo de contrato (puede ser múltiple)
    if (req.query.tipo_contrato) {
      const tiposContrato = req.query.tipo_contrato.split(',');
      whereClause.tipo_contrato = { [Op.in]: tiposContrato };
    }

    // Si había filtros simples, intégralos también
    if (req.query.nombre) whereClause.nombre = { [Op.iLike]: `%${req.query.nombre}%` };
    if (req.query.cargo) whereClause.cargo = req.query.cargo;

    const offset = (page - 1) * limit;

    // Determinación del ordenamiento
    let orderArray = [[sort, sequelizeOrder]];

    // Si el ordenamiento es por nombre completo (para mostrar nombre + apellido)
    if (sort === 'conductor') {
      orderArray = [['nombre', sequelizeOrder], ['apellido', sequelizeOrder]];
    }

    const { count, rows } = await Conductor.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: orderArray,
      include: [
        { model: Vehiculo, as: 'vehiculos', attributes: ['id', 'placa'] }
      ],
      distinct: true  // Importante para contar correctamente con includes
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

    // Emitir evento para todos los clientes conectados
    const emitConductorEvent = req.app.get('emitConductorEvent');
    if (emitConductorEvent) {
      emitConductorEvent('conductor:actualizado', conductorActualizado);
    }

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
      attributes: ['id', 'nombre', 'apellido', "numero_identificacion", "salario_base"]
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