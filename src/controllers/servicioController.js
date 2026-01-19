const { User, Servicio, Municipio, Conductor, Vehiculo, Empresa, ServicioHistorico, ServicioCancelado, Documento } = require('../models');
const { notificarGlobal } = require('../utils/notificar');

const verificarDisponibilidad = async (conductorId, vehiculoId, servicioIdExcluir = null) => {
  const errores = [];

  // Verificar si el conductor ya está en un servicio "en_curso"
  if (conductorId) {
    const whereCondition = {
      conductor_id: conductorId,
      estado: 'en_curso'
    };

    // Si estamos actualizando, excluir el servicio actual
    if (servicioIdExcluir) {
      whereCondition.id = { [require('sequelize').Op.ne]: servicioIdExcluir };
    }

    const conductorEnServicio = await Servicio.findOne({
      where: whereCondition,
      attributes: ['id', 'origen_especifico', 'destino_especifico'],
      include: [
        { model: Municipio, as: 'origen', attributes: ['nombre_municipio'] },
        { model: Municipio, as: 'destino', attributes: ['nombre_municipio'] }
      ]
    });

    if (conductorEnServicio) {
      const ruta = `${conductorEnServicio.origen?.nombre_municipio || conductorEnServicio.origen_especifico} → ${conductorEnServicio.destino?.nombre_municipio || conductorEnServicio.destino_especifico}`;
      errores.push({
        tipo: 'conductor',
        mensaje: `El conductor no está disponible porque ya se encuentra realizando un servicio en curso (Servicio #${conductorEnServicio.id}: ${ruta})`
      });
    }
  }

  // Verificar si el vehículo ya está en un servicio "en_curso"
  if (vehiculoId) {
    const whereCondition = {
      vehiculo_id: vehiculoId,
      estado: 'en_curso'
    };

    // Si estamos actualizando, excluir el servicio actual
    if (servicioIdExcluir) {
      whereCondition.id = { [require('sequelize').Op.ne]: servicioIdExcluir };
    }

    const vehiculoEnServicio = await Servicio.findOne({
      where: whereCondition,
      attributes: ['id', 'origen_especifico', 'destino_especifico'],
      include: [
        { model: Municipio, as: 'origen', attributes: ['nombre_municipio'] },
        { model: Municipio, as: 'destino', attributes: ['nombre_municipio'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['placa'] }
      ]
    });

    if (vehiculoEnServicio) {
      const ruta = `${vehiculoEnServicio.origen?.nombre_municipio || vehiculoEnServicio.origen_especifico} → ${vehiculoEnServicio.destino?.nombre_municipio || vehiculoEnServicio.destino_especifico}`;
      errores.push({
        tipo: 'vehiculo',
        mensaje: `El vehículo ${vehiculoEnServicio.vehiculo?.placa || 'seleccionado'} no está disponible porque ya se encuentra en un servicio en curso (Servicio #${vehiculoEnServicio.id}: ${ruta})`
      });
    }
  }

  return errores;
};

// Obtener todos los servicios (paginado)
exports.obtenerTodos = async (req, res) => {
  try {
    const usuarioActualId = req.user?.id;

    if (!usuarioActualId) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado'
      });
    }

    // Parámetros de paginación
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limitRaw = parseInt(req.query.limit || '20', 10);
    const limit = Math.min(Math.max(limitRaw || 20, 1), 100); // 1..100
    const offset = (page - 1) * limit;

    // Orden opcional
    const requestedSort = (req.query.sort || 'created_at').toString();
    const allowedSort = ['created_at', 'updated_at', 'id', 'fecha_solicitud'];
    const sort = allowedSort.includes(requestedSort) ? requestedSort : 'id';
    const order = (req.query.order || 'DESC').toString().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Filtros
    const where = {};
    const { Op } = require('sequelize');

    const {
      estado,
      proposito_servicio,
      conductor_id,
      cliente_id,
      vehiculo_id,
      origen_id,
      destino_id,
      fecha_solicitud: fecha_inicio,
      fecha_realizacion: fecha_fin
    } = req.query || {};

    if (estado) where.estado = estado;
    if (proposito_servicio) where.proposito_servicio = proposito_servicio;
    if (conductor_id) where.conductor_id = conductor_id;
    if (cliente_id) where.cliente_id = cliente_id;
    if (vehiculo_id) where.vehiculo_id = vehiculo_id;
    if (origen_id) where.origen_id = origen_id;
    if (destino_id) where.destino_id = destino_id;
    if (fecha_inicio && fecha_fin) {
      where.fecha_solicitud = { [Op.between]: [new Date(fecha_inicio), new Date(fecha_fin)] };
    } else if (fecha_inicio) {
      where.fecha_solicitud = { [Op.gte]: new Date(fecha_inicio) };
    } else if (fecha_fin) {
      where.fecha_solicitud = { [Op.lte]: new Date(fecha_fin) };
    }

    // Obtener servicios con paginación, filtros y count total
    const { count, rows } = await Servicio.findAndCountAll({
      where,
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ],
      limit,
      offset,
      order: [[sort, order]],
      distinct: true // asegura count correcto con joins
    });

    // Obtenemos los IDs de todos los servicios
    const servicioIds = rows.map(s => s.id);

    // Consulta separada para obtener los creadores
    const historicosCreacion = await ServicioHistorico.findAll({
      where: {
        servicio_id: servicioIds,
        campo_modificado: 'creacion_servicio',
        tipo_operacion: 'creacion'
      },
      attributes: ['servicio_id', 'usuario_id'],
      order: [['created_at', 'ASC']]
    });

    // Crear un mapa de servicio_id -> creador_id
    const mapaCreadores = {};
    historicosCreacion.forEach(historico => {
      if (!mapaCreadores[historico.servicio_id]) {
        mapaCreadores[historico.servicio_id] = historico.usuario_id;
      }
    });

    // Procesar los servicios para agregar el identificador de creador
    const serviciosConCreador = rows.map(servicio => {
      const servicioData = servicio.toJSON();
      const creadorId = mapaCreadores[servicio.id] || null;

      servicioData.es_creador = creadorId === usuarioActualId;
      servicioData.creador_id = creadorId;

      return servicioData;
    });

    // Stats agregados por estado bajo los mismos filtros
    // Total general filtrado
    const totalFiltrado = await Servicio.count({ where });

    // Conteos por estado usando GROUP BY
    const agregados = await Servicio.findAll({
      where,
      attributes: [
        'estado',
        [Servicio.sequelize.fn('COUNT', Servicio.sequelize.col('*')), 'count']
      ],
      group: ['estado'],
      raw: true
    });

    const baseStats = {
      total: totalFiltrado,
      en_curso: 0,
      realizado: 0,
      solicitado: 0,
      planificado: 0,
      cancelado: 0
    };

    for (const row of agregados) {
      const estadoKey = row.estado;
      const value = parseInt(row.count, 10) || 0;
      if (estadoKey && Object.prototype.hasOwnProperty.call(baseStats, estadoKey)) {
        baseStats[estadoKey] = value;
      }
    }

    return res.status(200).json({
      success: true,
      data: serviciosConCreador,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        count: serviciosConCreador.length
      },
      stats: baseStats
    });
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener servicios',
      error: error.message
    });
  }
};

// Obtener un servicio por ID
exports.obtenerPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const servicio = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        {
          model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', 'nit', 'requiere_osi'] },
        {
          model: ServicioCancelado, as: 'cancelacion', attributes: ['id', 'motivo_cancelacion', 'observaciones', 'fecha_cancelacion', 'created_at', 'updated_at'],
          include: [
            { model: User, as: 'usuario_cancelacion', attributes: ['id', 'nombre', 'role'] }
          ]
        }
      ]
    });

    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      data: servicio
    });
  } catch (error) {
    console.error('Error al obtener el servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el servicio',
      error: error.message
    });
  }
};

// Crear un nuevo servicio
exports.crear = async (req, res) => {
  try {
    const {
      origen_id,
      destino_id,
      origen_especifico,
      destino_especifico,
      origen_latitud,
      origen_longitud,
      destino_latitud,
      destino_longitud,
      conductor_id,
      vehiculo_id,
      cliente_id,
      estado,
      proposito_servicio,
      fecha_solicitud,
      fecha_realizacion,
      fecha_finalizacion, // ← Capturar fecha_finalizacion
      valor,
      observaciones
    } = req.body;

    // Validación adicional de datos, si es necesario
    if (!origen_id || !destino_id || !cliente_id) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios para crear el servicio'
      });
    }

    // Convertir cadenas vacías a null
    const conductorId = conductor_id === '' ? null : conductor_id;
    const vehiculoId = vehiculo_id === '' ? null : vehiculo_id;

    // Si el estado es distinto de 'solicitado', conductor y vehiculo son obligatorios
    if (estado && estado.toLowerCase() !== 'solicitado') {
      if (!conductorId) {
        return res.status(400).json({
          success: false,
          message: 'El conductor es requerido cuando el estado no es "solicitado"'
        });
      }
      if (!vehiculoId) {
        return res.status(400).json({
          success: false,
          message: 'El vehículo es requerido cuando el estado no es "solicitado"'
        });
      }
    }

    if ((conductorId || vehiculoId) && !fecha_finalizacion) {
      const erroresDisponibilidad = await verificarDisponibilidad(conductorId, vehiculoId);

      if (erroresDisponibilidad.length > 0) {
        // Generar mensaje dinámico basado en los tipos de conflictos
        let mensajePrincipal;
        const tieneErrorConductor = erroresDisponibilidad.some(error => error.tipo === 'conductor');
        const tieneErrorVehiculo = erroresDisponibilidad.some(error => error.tipo === 'vehiculo');

        if (tieneErrorConductor && tieneErrorVehiculo) {
          mensajePrincipal = 'No se puede crear el servicio porque el conductor y el vehículo no se encuentran disponibles';
        } else if (tieneErrorConductor) {
          mensajePrincipal = 'No se puede crear el servicio porque el conductor no se encuentra disponible';
        } else if (tieneErrorVehiculo) {
          mensajePrincipal = 'No se puede crear el servicio porque el vehículo no se encuentra disponible';
        } else {
          mensajePrincipal = 'No se puede crear el servicio por conflictos de disponibilidad';
        }

        return res.status(400).json({
          success: false,
          message: mensajePrincipal,
          errores: erroresDisponibilidad
        });
      }
    }

    const promises = [
      Municipio.findByPk(origen_id),
      Municipio.findByPk(destino_id),
      conductorId ? Conductor.findByPk(conductorId) : Promise.resolve(null),
      vehiculoId ? Vehiculo.findByPk(vehiculoId) : Promise.resolve(null),
      Empresa.findByPk(cliente_id)
    ];

    const [origen, destino, conductor, vehiculo, cliente] = await Promise.all(promises);

    // Verificaciones de existencia...
    if (!origen || !destino || !cliente) {
      return res.status(400).json({
        success: false,
        message: 'Uno o más de los IDs de referencia no existen en la base de datos'
      });
    }

    if (conductorId && !conductor) {
      return res.status(400).json({
        success: false,
        message: 'El conductor especificado no existe en la base de datos'
      });
    }

    if (vehiculoId && !vehiculo) {
      return res.status(400).json({
        success: false,
        message: 'El vehículo especificado no existe en la base de datos'
      });
    }

    // Crear el servicio
    const nuevoServicio = await Servicio.create({
      origen_id,
      destino_id,
      origen_especifico,
      destino_especifico,
      origen_latitud,
      origen_longitud,
      destino_latitud,
      destino_longitud,
      conductor_id: conductorId,
      vehiculo_id: vehiculoId,
      cliente_id,
      estado: estado || 'planificado',
      proposito_servicio,
      fecha_solicitud,
      fecha_realizacion,
      fecha_finalizacion, // ← Incluir fecha_finalizacion
      valor,
      observaciones
    }, {
      user_id: req.user.id,
      ip_usuario: req.ip,
      navegador_usuario: req.headers['user-agent'],
      detalles: {
        origen: 'API',
        ruta: req.originalUrl,
        metodo: req.method
      }
    });

    // Obtener el servicio con sus relaciones
    const servicioCreado = await Servicio.findByPk(nuevoServicio.id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ]
    });

    notificarGlobal("servicio:creado", servicioCreado);

    return res.status(201).json({
      success: true,
      message: 'Servicio creado exitosamente',
      data: servicioCreado
    });

  } catch (error) {
    console.error('Error al crear el servicio:', error);
    // Manejo específico de errores de validación de Sequelize
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Error al crear el servicio',
      error: error.message
    });
  }
};

// Actualizar un servicio existente
exports.actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      origen_id,
      destino_id,
      origen_especifico,
      destino_especifico,
      origen_latitud,
      origen_longitud,
      destino_latitud,
      destino_longitud,
      conductor_id,
      vehiculo_id,
      cliente_id,
      estado,
      proposito_servicio,
      fecha_solicitud,
      fecha_realizacion,
      fecha_finalizacion, // ← Capturar fecha_finalizacion
      valor,
      observaciones
    } = req.body;

    // Verificar que el servicio exista
    const servicio = await Servicio.findByPk(id);
    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Determinar qué conductor y vehículo se van a asignar después de la actualización
    let conductorFinalId = servicio.conductor_id;
    let vehiculoFinalId = servicio.vehiculo_id;

    // Actualizar los IDs finales basado en lo que viene en la petición
    if (req.body.hasOwnProperty('conductor_id')) {
      const conductorDesasociado = conductor_id === null || conductor_id === '' || conductor_id === undefined;
      conductorFinalId = conductorDesasociado ? null : conductor_id;
    }

    if (req.body.hasOwnProperty('vehiculo_id')) {
      const vehiculoDesasociado = vehiculo_id === null || vehiculo_id === '' || vehiculo_id === undefined;
      vehiculoFinalId = vehiculoDesasociado ? null : vehiculo_id;
    }

    // Determinar si el servicio estará finalizado después de la actualización
    const servicioFinalizadoActual = !!servicio.fecha_finalizacion;
    const servicioFinalizadoNuevo = fecha_finalizacion !== undefined ? !!fecha_finalizacion : servicioFinalizadoActual;

    // Solo verificar disponibilidad si se están asignando conductor o vehículo,
    // han cambiado respecto a los valores actuales Y el servicio NO está finalizado
    const conductorCambio = conductorFinalId !== servicio.conductor_id;
    const vehiculoCambio = vehiculoFinalId !== servicio.vehiculo_id;

    if (((conductorCambio && conductorFinalId) || (vehiculoCambio && vehiculoFinalId)) && !servicioFinalizadoNuevo) {
      const erroresDisponibilidad = await verificarDisponibilidad(
        conductorCambio ? conductorFinalId : null,
        vehiculoCambio ? vehiculoFinalId : null,
        id // Excluir el servicio actual de la validación
      );

      if (erroresDisponibilidad.length > 0) {
        let mensajePrincipal;
        const tieneErrorConductor = erroresDisponibilidad.some(error => error.tipo === 'conductor');
        const tieneErrorVehiculo = erroresDisponibilidad.some(error => error.tipo === 'vehiculo');

        if (tieneErrorConductor && tieneErrorVehiculo) {
          mensajePrincipal = 'No se puede actualizar el servicio porque el conductor y el vehículo no se encuentran disponibles';
        } else if (tieneErrorConductor) {
          mensajePrincipal = 'No se puede actualizar el servicio porque el conductor no se encuentra disponible';
        } else if (tieneErrorVehiculo) {
          mensajePrincipal = 'No se puede actualizar el servicio porque el vehículo no se encuentra disponible';
        } else {
          mensajePrincipal = 'No se puede actualizar el servicio por conflictos de disponibilidad';
        }

        return res.status(400).json({
          success: false,
          message: mensajePrincipal,
          errores: erroresDisponibilidad
        });
      }
    }

    // Si se cambiaron IDs de referencia, verificar que existan
    const promises = [];
    if (origen_id && origen_id !== servicio.origen_id) {
      promises.push(Municipio.findByPk(origen_id));
    }
    if (destino_id && destino_id !== servicio.destino_id) {
      promises.push(Municipio.findByPk(destino_id));
    }

    // Solo verificar los IDs de conductor si se proporciona un ID válido (no nulo o vacío)
    if (req.body.hasOwnProperty('conductor_id') && conductor_id && conductor_id !== servicio.conductor_id) {
      promises.push(Conductor.findByPk(conductor_id));
    }

    // Solo verificar los IDs de vehículo si se proporciona un ID válido (no nulo o vacío)
    if (req.body.hasOwnProperty('vehiculo_id') && vehiculo_id && vehiculo_id !== servicio.vehiculo_id) {
      promises.push(Vehiculo.findByPk(vehiculo_id));
    }

    if (cliente_id && cliente_id !== servicio.cliente_id) {
      promises.push(Empresa.findByPk(cliente_id));
    }

    if (promises.length > 0) {
      const results = await Promise.all(promises);
      if (results.some(result => !result)) {
        return res.status(400).json({
          success: false,
          message: 'Uno o más de los IDs de referencia no existen en la base de datos'
        });
      }
    }

    // Preparar objeto de actualización
    const updateData = {
      origen_id: origen_id || servicio.origen_id,
      destino_id: destino_id || servicio.destino_id,
      origen_especifico: origen_especifico || servicio.origen_especifico,
      destino_especifico: destino_especifico || servicio.destino_especifico,
      origen_latitud: origen_latitud !== undefined ? origen_latitud : servicio.origen_latitud,
      origen_longitud: origen_longitud !== undefined ? origen_longitud : servicio.origen_longitud,
      destino_latitud: destino_latitud !== undefined ? destino_latitud : servicio.destino_latitud,
      destino_longitud: destino_longitud !== undefined ? destino_longitud : servicio.destino_longitud,
      cliente_id: cliente_id || servicio.cliente_id,
      estado: estado || servicio.estado,
      proposito_servicio: proposito_servicio || servicio.proposito_servicio,
      fecha_solicitud: fecha_solicitud || servicio.fecha_solicitud,
      fecha_realizacion: fecha_realizacion || servicio.fecha_realizacion,
      fecha_finalizacion: fecha_finalizacion !== undefined ? fecha_finalizacion : servicio.fecha_finalizacion, // ← Incluir fecha_finalizacion
      valor: valor || servicio.valor,
      observaciones: observaciones !== undefined ? observaciones : servicio.observaciones,
      estado: fecha_finalizacion ? 'realizado' : (estado || servicio.estado) // Si hay fecha_finalizacion, forzar estado a 'finalizado'
    };

    // Manejar conductor_id: si está presente en req.body pero es null/vacío, lo establecemos a null
    // para desasociar al conductor del servicio
    if (req.body.hasOwnProperty('conductor_id')) {
      // Si conductor_id está presente pero es null, vacío o undefined, asignar null
      const conductorDesasociado = conductor_id === null || conductor_id === '' || conductor_id === undefined;
      updateData.conductor_id = conductorDesasociado ? null : conductor_id;

      // Agregar detalle especial para el registro histórico si se está desasociando un conductor
      if (conductorDesasociado && servicio.conductor_id) {
        if (!updateData.detalles) updateData.detalles = {};
        updateData.detalles.conductor_desasociado = true;
        updateData.detalles.conductor_id_anterior = servicio.conductor_id;
        updateData.detalles.descripcion_cambio_conductor = "Se desvinculó el conductor del servicio";

        // Obtener información del conductor que se está desvinculando para el histórico
        try {
          // Buscar los datos del conductor para tener información más completa en el histórico
          const conductorAnterior = await Conductor.findByPk(servicio.conductor_id, {
            attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono']
          });

          let valorAnterior = `Conductor ID: ${servicio.conductor_id}`;
          if (conductorAnterior) {
            valorAnterior = `Conductor: ${conductorAnterior.nombre} ${conductorAnterior.apellido} (${conductorAnterior.tipo_identificacion}: ${conductorAnterior.numero_identificacion})`;
          }

          // Crear un registro histórico específico para la desvinculación del conductor
          await ServicioHistorico.create({
            servicio_id: servicio.id,
            usuario_id: req.user.id,
            campo_modificado: 'desvinculacion_conductor',
            valor_anterior: valorAnterior,
            valor_nuevo: 'Sin conductor asignado',
            tipo_operacion: 'actualizacion',
            ip_usuario: req.ip || null,
            navegador_usuario: req.headers['user-agent'] || null,
            detalles: {
              origen: 'API',
              ruta: req.originalUrl,
              metodo: req.method,
              accion: 'Desvinculación de conductor',
              conductor_id_anterior: servicio.conductor_id,
              datos_conductor: conductorAnterior ? conductorAnterior.toJSON() : null
            }
          });
        } catch (error) {
          console.error('Error al registrar la desvinculación del conductor en histórico:', error);
        }
      }
    } else {
      updateData.conductor_id = servicio.conductor_id;
    }

    // Manejar vehiculo_id: si está presente en req.body pero es null/vacío, lo establecemos a null
    // para desasociar al vehículo del servicio
    if (req.body.hasOwnProperty('vehiculo_id')) {
      // Si vehiculo_id está presente pero es null, vacío o undefined, asignar null
      const vehiculoDesasociado = vehiculo_id === null || vehiculo_id === '' || vehiculo_id === undefined;
      updateData.vehiculo_id = vehiculoDesasociado ? null : vehiculo_id;

      // Agregar detalle especial para el registro histórico si se está desasociando un vehículo
      if (vehiculoDesasociado && servicio.vehiculo_id) {
        if (!updateData.detalles) updateData.detalles = {};
        updateData.detalles.vehiculo_desasociado = true;
        updateData.detalles.vehiculo_id_anterior = servicio.vehiculo_id;
        updateData.detalles.descripcion_cambio_vehiculo = "Se desvinculó el vehículo del servicio";

        // Obtener información del vehículo que se está desvinculando para el histórico
        try {
          // Buscar los datos del vehículo para tener información más completa en el histórico
          const vehiculoAnterior = await Vehiculo.findByPk(servicio.vehiculo_id, {
            attributes: ['id', 'placa', 'marca', 'linea', 'modelo', "color", "clase_vehiculo"]
          });

          let valorAnterior = `Vehículo ID: ${servicio.vehiculo_id}`;
          if (vehiculoAnterior) {
            valorAnterior = `Vehículo: ${vehiculoAnterior.placa} (${vehiculoAnterior.marca} ${vehiculoAnterior.linea} - ${vehiculoAnterior.modelo})`;
          }

          // Crear un registro histórico específico para la desvinculación del vehículo
          await ServicioHistorico.create({
            servicio_id: servicio.id,
            usuario_id: req.user.id,
            campo_modificado: 'desvinculacion_vehiculo',
            valor_anterior: valorAnterior,
            valor_nuevo: 'Sin vehículo asignado',
            tipo_operacion: 'actualizacion',
            ip_usuario: req.ip || null,
            navegador_usuario: req.headers['user-agent'] || null,
            detalles: {
              origen: 'API',
              ruta: req.originalUrl,
              metodo: req.method,
              accion: 'Desvinculación de vehículo',
              vehiculo_id_anterior: servicio.vehiculo_id,
              datos_vehiculo: vehiculoAnterior ? vehiculoAnterior.toJSON() : null
            }
          });
        } catch (error) {
          console.error('Error al registrar la desvinculación del vehículo en histórico:', error);
        }
      }
    } else {
      updateData.vehiculo_id = servicio.vehiculo_id;
    }

    // Manejar específicamente el cambio en observaciones para el histórico
    if (req.body.hasOwnProperty('observaciones') && (
      // Caso 1: Cambio de observaciones vacías a observaciones con contenido
      ((servicio.observaciones === null || servicio.observaciones === '' || servicio.observaciones === undefined) &&
        (observaciones !== null && observaciones !== '' && observaciones !== undefined)) ||
      // Caso 2: Cambio de observaciones con contenido a observaciones vacías
      ((observaciones === null || observaciones === '' || observaciones === undefined) &&
        (servicio.observaciones !== null && servicio.observaciones !== '' && servicio.observaciones !== undefined))
    )) {

      try {
        // Crear un registro histórico específico para el cambio de observaciones vacías a no vacías o viceversa
        const esVacioAnterior = !servicio.observaciones || servicio.observaciones.trim() === '';
        const esVacioNuevo = !observaciones || observaciones.trim() === '';

        const valorAnterior = esVacioAnterior ? '(Sin observaciones)' : servicio.observaciones;
        const valorNuevo = esVacioNuevo ? '(Sin observaciones)' : observaciones;

        // Solo registrar si hay un cambio real entre vacío y con valor o viceversa
        if (esVacioAnterior !== esVacioNuevo) {

          await ServicioHistorico.create({
            servicio_id: servicio.id,
            usuario_id: req.user.id,
            campo_modificado: 'cambio_observaciones',
            valor_anterior: valorAnterior,
            valor_nuevo: valorNuevo,
            tipo_operacion: 'actualizacion',
            ip_usuario: req.ip || null,
            navegador_usuario: req.headers['user-agent'] || null,
            detalles: {
              origen: 'API',
              ruta: req.originalUrl,
              metodo: req.method,
              accion: esVacioNuevo ?
                'Eliminación de observaciones' :
                'Adición de observaciones (campo vacío a campo con valor)'
            }
          });
        }
      } catch (error) {
        console.error('Error al registrar cambio de observaciones en histórico:', error);
      }
    }

    // Preparar opciones para el histórico
    const updateOptions = {
      user_id: req.user.id, // Pasar el ID del usuario para el histórico
      ip_usuario: req.ip,
      navegador_usuario: req.headers['user-agent'],
      detalles: {
        origen: 'API',
        ruta: req.originalUrl,
        metodo: req.method
      }
    };

    // Agregar información de desasociación a los detalles si es necesario
    if (updateData.detalles) {
      updateOptions.detalles = { ...updateOptions.detalles, ...updateData.detalles };
    }

    // Actualizar el servicio
    await servicio.update(updateData, updateOptions);

    // Obtener el servicio actualizado con sus relaciones
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ]
    });

    notificarGlobal("servicio:actualizado", servicioActualizado);

    return res.status(200).json({
      success: true,
      message: 'Servicio actualizado exitosamente',
      data: servicioActualizado
    });

  } catch (error) {
    console.error('Error al actualizar el servicio:', error);
    // Manejo específico de errores de validación de Sequelize
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el servicio',
      error: error.message
    });
  }
};

// Eliminar un servicio
exports.eliminar = async (req, res) => {
  try {
    const { id } = req.params;

    const servicio = await Servicio.findByPk(id, {
      include: [
        { model: Conductor, as: 'conductor', attributes: ['id'] }
      ]
    });

    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Guardar información relevante antes de eliminar
    const conductorId = servicio.conductor ? servicio.conductor.id : null;
    const servicioInfo = {
      id: servicio.id,
      estado: servicio.estado,
      fecha_solicitud: servicio.fecha_solicitud,
      fecha_realizacion: servicio.fecha_realizacion,
      mensaje: 'Este servicio ha sido eliminado'
    };

    // Eliminar el servicio
    await servicio.destroy({
      user_id: req.user.id, // Pasar el ID del usuario para el histórico
      ip_usuario: req.ip,
      navegador_usuario: req.headers['user-agent'],
      detalles: {
        origen: 'API',
        ruta: req.originalUrl,
        metodo: req.method
      }
    });

    notificarGlobal("servicio:eliminado", { id: servicioInfo.id, conductor_id: conductorId });

    return res.status(200).json({
      success: true,
      message: 'Servicio eliminado exitosamente',
      data: { id }
    });
  } catch (error) {
    console.error('Error al eliminar el servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar el servicio',
      error: error.message
    });
  }
};

// Cancelar un servicio
exports.cancelar = async (req, res) => {
  const transaction = await Servicio.sequelize.transaction();

  try {
    const { id } = req.params;
    const {
      motivo_cancelacion = 'otro',
      observaciones = '',
      fecha_cancelacion
    } = req.body;

    // Buscar el servicio con sus relaciones (siguiendo el mismo patrón que cambiarEstado)
    const servicio = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
        },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ],
      transaction
    });

    if (!servicio) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Verificar que el servicio no esté ya cancelado
    if (servicio.estado === 'cancelado') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'El servicio ya se encuentra cancelado'
      });
    }

    // Verificar que el servicio se pueda cancelar (no esté liquidado)
    if (servicio.estado === 'liquidado') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'No se puede cancelar un servicio que ya ha sido liquidado'
      });
    }

    // Guardar el estado anterior para comparación
    const estadoAnterior = servicio.estado;

    // Actualizar el estado del servicio a cancelado y las observaciones
    await servicio.update({
      estado: 'cancelado',
    }, {
      transaction,
      user_id: req.user.id, // Pasar el ID del usuario para el histórico
      ip_usuario: req.ip,
      detalles: {
        origen: 'API',
        ruta: req.originalUrl,
        metodo: req.method,
        estado_anterior: estadoAnterior,
      }
    });

    // Crear el registro de cancelación (solo si el modelo existe)
    let cancelacion = null;

    try {
      cancelacion = await ServicioCancelado.create({
        servicio_id: id,
        usuario_cancelacion_id: req.user.id,
        motivo_cancelacion,
        observaciones,
        fecha_cancelacion
      }, { transaction });
    } catch (cancelacionError) {
      console.warn('No se pudo crear el registro de cancelación:', cancelacionError.message);
      // Continuar sin crear el registro de cancelación si el modelo no existe aún
    }

    await transaction.commit();

    // Obtener el servicio actualizado (siguiendo el mismo patrón que cambiarEstado)
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] },
        {
          model: ServicioCancelado, as: 'cancelacion', attributes: ['id', 'motivo_cancelacion', 'observaciones', 'fecha_cancelacion', 'created_at', 'updated_at'],
          include: [
            { model: User, as: 'usuario_cancelacion', attributes: ['id', 'nombre', 'role'] }
          ]
        }
      ]
    });

    // Notificar la cancelación (siguiendo el mismo patrón)
    notificarGlobal("servicio:cancelado", {
      ...servicioActualizado.toJSON(),
      motivo_cancelacion,
      cancelacion_id: cancelacion ? cancelacion.id : null,
      usuario_cancelo: req.user.id
    });

    return res.status(200).json({
      success: true,
      message: 'Servicio cancelado exitosamente',
      data: {
        ...servicioActualizado.toJSON(),
        estado_anterior: estadoAnterior,
        motivo_cancelacion,
        fecha_cancelacion: cancelacion ? cancelacion.fecha_cancelacion : new Date(),
        cancelacion_id: cancelacion ? cancelacion.id : null
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Error al cancelar el servicio:', error);

    // Manejar errores de validación
    if (error.name === 'SequelizeValidationError') {
      const errores = error.errors.map(err => ({
        campo: err.path,
        mensaje: err.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Error al cancelar el servicio',
      error: error.message
    });
  }
};

// Búsqueda avanzada de servicios
exports.buscarServicios = async (req, res) => {
  try {
    const {
      estado,
      proposito_servicio,
      fecha_solicitud,
      fecha_realizacion,
      conductor_id,
      cliente_id,
      origen_id,
      destino_id
    } = req.query;

    // Construir condiciones de búsqueda
    const where = {};

    if (estado) where.estado = estado;
    if (proposito_servicio) where.proposito_servicio = proposito_servicio;
    if (conductor_id) where.conductor_id = conductor_id;
    if (cliente_id) where.cliente_id = cliente_id;
    if (origen_id) where.origen_id = origen_id;
    if (destino_id) where.destino_id = destino_id;

    // Filtro de rango de fechas
    if (fecha_solicitud && fecha_realizacion) {
      where.fecha_solicitud = {
        [Op.between]: [new Date(fecha_solicitud), new Date(fecha_realizacion)]
      };
    } else if (fecha_solicitud) {
      where.fecha_solicitud = {
        [Op.gte]: new Date(fecha_solicitud)
      };
    } else if (fecha_realizacion) {
      where.fecha_solicitud = {
        [Op.lte]: new Date(fecha_realizacion)
      };
    }

    const servicios = await Servicio.findAll({
      where,
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ],
      order: [['fecha_solicitud', 'DESC']]
    });

    return res.status(200).json({
      success: true,
      data: servicios,
      total: servicios.length
    });
  } catch (error) {
    console.error('Error al buscar servicios:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al buscar servicios',
      error: error.message
    });
  }
};

// Cambiar estado de un servicio
exports.cambiarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, fecha_finalizacion } = req.body;

    if (
      !estado ||
      !['en_curso', 'realizado', 'planificado', 'cancelado'].includes(
        estado.toLowerCase()
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido'
      });
    }

    const servicio = await Servicio.findByPk(id, {
      include: [
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] }
      ]
    });

    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Guardar estado anterior para comparación
    const estadoAnterior = servicio.estado;

    // Actualizar solo el estado y registrar fecha de finalización si corresponde
    const datosActualizacion = { estado };

    // Si el estado es 'realizado', actualizar fecha_realizacion y opcionalmente fecha_finalizacion
    if (estado.toLowerCase() === 'realizado') {
      if (fecha_finalizacion) {
        datosActualizacion.fecha_finalizacion = fecha_finalizacion;
      }
    }

    await servicio.update(datosActualizacion, {
      user_id: req.user.id, // Pasar el ID del usuario para el histórico
      ip_usuario: req.ip,
      navegador_usuario: req.headers['user-agent'],
      detalles: {
        origen: 'API',
        ruta: req.originalUrl,
        metodo: req.method,
        estado_anterior: estadoAnterior
      }
    });

    // Obtener el servicio actualizado
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento', 'latitud', 'longitud'] },
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'],
          include: [
            {
              model: Documento,
              as: 'documentos',
              attributes: [
                'id',
                'categoria',
                'nombre_original',
                'nombre_archivo',
                'ruta_archivo',
                's3_key',
                'filename',
                'mimetype',
                'size',
                'fecha_vigencia',
                'estado',
                'upload_date',
                'metadata'
              ]
            }
          ]
        },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color", "clase_vehiculo"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ]
    });

    notificarGlobal("servicio:estado-cambiado", servicioActualizado);

    return res.status(200).json({
      success: true,
      message: `Servicio actualizado a estado ${estado}`,
      data: servicioActualizado
    });
  } catch (error) {
    console.error('Error al cambiar estado del servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al cambiar estado del servicio',
      error: error.message
    });
  }
};

// Añadir número de planilla a un servicio
exports.asignarNumeroPlanilla = async (req, res) => {
  try {
    const { id } = req.params;
    const { numero_planilla } = req.body;
    const user_id = req.user.id; // Asumiendo que tienes middleware de autenticación

    // Validar que se haya proporcionado un número de planilla
    if (!numero_planilla) {
      return res.status(400).json({
        success: false,
        message: 'El número de planilla es obligatorio'
      });
    }

    // Validar el formato del número de planilla
    if (!/^TM-\d{1,5}$/.test(numero_planilla)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de número de planilla no válido. Debe ser TM-XXXXX con 1 a 5 dígitos'
      });
    }

    const servicio = await Servicio.findByPk(id);

    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Pasar la información del usuario y datos adicionales para el historial
    await servicio.update(
      {
        numero_planilla,
        estado: 'planilla_asignada'  // Nuevo estado para indicar que tiene planilla
      },
      {
        user_id: user_id,
        ip_usuario: req.ip,
        navegador_usuario: req.headers['user-agent'],
        detalles: {
          origen: 'API',
          ruta: req.originalUrl,
          metodo: req.method
        }
      }
    );

    // Obtener el servicio actualizado
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre'] }
      ]
    });

    notificarGlobal("servicio:planilla-asignada", servicioActualizado);

    return res.status(200).json({
      success: true,
      message: `Número de planilla ${numero_planilla} asignado al servicio`,
      data: servicioActualizado
    });
  } catch (error) {
    console.error('Error al asignar número de planilla al servicio:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al asignar número de planilla al servicio',
      error: error.message
    });
  }
};

exports.generarEnlacePublico = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el servicio existe
    const servicio = await Servicio.findByPk(id);
    if (!servicio) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Si ya tiene un token válido, reutilizarlo
    if (servicio.share_token) {
      // Verificar si el token expiró (si tiene fecha de expiración)
      if (!servicio.share_token_expires_at || new Date(servicio.share_token_expires_at) > new Date()) {
        return res.status(200).json({
          success: true,
          data: {
            share_token: servicio.share_token,
            expires_at: servicio.share_token_expires_at,
            servicio_id: id
          }
        });
      }
    }

    // Generar nuevo token único
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    // Configurar expiración (opcional, null = sin expiración)
    // Para habilitar expiración, descomentar la siguiente línea:
    // const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días

    // Actualizar servicio con el token
    await servicio.update({
      share_token: token,
      share_token_expires_at: null // o expiresAt si quieres expiración
    });

    return res.status(200).json({
      success: true,
      data: {
        share_token: token,
        expires_at: servicio.share_token_expires_at,
        servicio_id: id
      }
    });
  } catch (error) {
    console.error('Error generar enlace público:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generando enlace público',
      error: error.message
    });
  }
};

// Revocar token (placeholder)
exports.revocarToken = async (req, res) => {
  try {
    const { token } = req.params;

    return res.status(200).json({
      success: true,
      message: 'Token revocado exitosamente',
      data: { token }
    });
  } catch (error) {
    console.error('Error revocar token:', error);
    return res.status(500).json({
      success: false,
      message: 'Error revocando token',
      error: error.message
    });
  }
};