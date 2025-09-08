const { Servicio, Municipio, Conductor, Vehiculo, Empresa, ServicioHistorico, Documento } = require('../models');

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

// Obtener todos los servicios
exports.obtenerTodos = async (req, res) => {
  try {
    const usuarioActualId = req.user?.id;

    if (!usuarioActualId) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado'
      });
    }

    // Primero obtenemos todos los servicios
    const servicios = await Servicio.findAll({
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
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ]
    });

    // Obtenemos los IDs de todos los servicios
    const servicioIds = servicios.map(s => s.id);

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
    const serviciosConCreador = servicios.map(servicio => {
      const servicioData = servicio.toJSON();
      const creadorId = mapaCreadores[servicio.id] || null;

      servicioData.es_creador = creadorId === usuarioActualId;
      servicioData.creador_id = creadorId;

      return servicioData;
    });

    return res.status(200).json({
      success: true,
      data: serviciosConCreador,
      total: serviciosConCreador.length
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
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion', 'telefono'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
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

    // ✅ NUEVA VALIDACIÓN: Verificar disponibilidad de conductor y vehículo
    // Solo verificar si se están asignando conductor o vehículo
    if (conductorId || vehiculoId) {
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

    // Verificar que existan los registros relacionados, omitiendo los valores nulos
    const promises = [
      Municipio.findByPk(origen_id),
      Municipio.findByPk(destino_id),
      // Solo buscar conductor y vehículo si los IDs no son nulos
      conductorId ? Conductor.findByPk(conductorId) : Promise.resolve(null),
      vehiculoId ? Vehiculo.findByPk(vehiculoId) : Promise.resolve(null),
      Empresa.findByPk(cliente_id)
    ];

    const [origen, destino, conductor, vehiculo, cliente] = await Promise.all(promises);

    // Verificar las entidades obligatorias
    if (!origen || !destino || !cliente) {
      return res.status(400).json({
        success: false,
        message: 'Uno o más de los IDs de referencia no existen en la base de datos'
      });
    }

    // Verificar conductor y vehículo solo si se proporcionaron IDs
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
      conductor_id: conductorId,  // Usar la versión convertida
      vehiculo_id: vehiculoId,    // Usar la versión convertida
      cliente_id,
      estado: estado || 'planificado',
      proposito_servicio,
      fecha_solicitud,
      fecha_realizacion,
      valor,
      observaciones
    }, {
      user_id: req.user.id, // Pasar el ID del usuario para el histórico
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
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ]
    });

    // Emitir evento para todos los clientes conectados
    const emitServicioEvent = req.app.get('emitServicioEvent');
    if (emitServicioEvent) {
      emitServicioEvent('servicio:creado', servicioCreado);
    }

    // Emitir evento específicamente para el conductor asignado
    if (conductorId) {
      const emitServicioToUser = req.app.get('emitServicioToUser');
      if (emitServicioToUser) {
        emitServicioToUser(conductorId, 'servicio:asignado', servicioCreado);
      }
    }

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

    // ✅ NUEVA VALIDACIÓN: Verificar disponibilidad de conductor y vehículo al actualizar
    // Determinar qué conductor y vehículo se van a asignar después de la actualización
    let conductorFinalId = servicio.conductor_id; // Valor actual por defecto
    let vehiculoFinalId = servicio.vehiculo_id; // Valor actual por defecto

    // Actualizar los IDs finales basado en lo que viene en la petición
    if (req.body.hasOwnProperty('conductor_id')) {
      const conductorDesasociado = conductor_id === null || conductor_id === '' || conductor_id === undefined;
      conductorFinalId = conductorDesasociado ? null : conductor_id;
    }

    if (req.body.hasOwnProperty('vehiculo_id')) {
      const vehiculoDesasociado = vehiculo_id === null || vehiculo_id === '' || vehiculo_id === undefined;
      vehiculoFinalId = vehiculoDesasociado ? null : vehiculo_id;
    }

    // Solo verificar disponibilidad si se están asignando conductor o vehículo
    // y si han cambiado respecto a los valores actuales
    const conductorCambio = conductorFinalId !== servicio.conductor_id;
    const vehiculoCambio = vehiculoFinalId !== servicio.vehiculo_id;

    if ((conductorCambio && conductorFinalId) || (vehiculoCambio && vehiculoFinalId)) {
      const erroresDisponibilidad = await verificarDisponibilidad(
        conductorCambio ? conductorFinalId : null, // Solo verificar si cambió
        vehiculoCambio ? vehiculoFinalId : null,   // Solo verificar si cambió
        id // Excluir el servicio actual de la validación
      );

      if (erroresDisponibilidad.length > 0) {
        // Generar mensaje dinámico basado en los tipos de conflictos
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

    // Guardar el ID del conductor anterior para notificaciones
    const conductorAnteriorId = servicio.conductor_id;

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
      valor: valor || servicio.valor,
      // Manejo especial para observaciones: preservar cadenas vacías cuando se envían explícitamente
      observaciones: observaciones !== undefined ? observaciones : servicio.observaciones
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
          console.log(`Registro histórico creado para la desvinculación del conductor en servicio ID: ${servicio.id}`);
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
            attributes: ['id', 'placa', 'marca', 'linea', 'modelo', "color"]
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
          console.log(`Registro histórico creado para la desvinculación del vehículo en servicio ID: ${servicio.id}`);
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

          console.log(`Registro histórico creado para el cambio de observaciones en servicio ID: ${servicio.id}`);
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
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea", "color"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre', "nit", "requiere_osi"] }
      ]
    });

    // Emitir evento para todos los clientes conectados
    const emitServicioEvent = req.app.get('emitServicioEvent');
    if (emitServicioEvent) {
      emitServicioEvent('servicio:actualizado', servicioActualizado);
    }

    // Emitir notificación al conductor si ha cambiado
    const emitServicioToUser = req.app.get('emitServicioToUser');
    if (emitServicioToUser) {
      // Notificar al conductor nuevo (si se ha asignado uno)
      if (updateData.conductor_id && updateData.conductor_id !== conductorAnteriorId) {
        emitServicioToUser(updateData.conductor_id, 'servicio:asignado', servicioActualizado);
      }

      // Notificar al conductor anterior que se le ha quitado el servicio (si había uno y ha cambiado o se ha eliminado)
      if (conductorAnteriorId &&
        (req.body.hasOwnProperty('conductor_id') &&
          (updateData.conductor_id !== conductorAnteriorId || updateData.conductor_id === null))) {

        // Mensaje específico para cuando se elimina completamente la asignación
        const mensaje = updateData.conductor_id === null ?
          'Este servicio ha sido desvinculado de tu cuenta' :
          'Este servicio ya no está asignado a usted';

        emitServicioToUser(conductorAnteriorId, 'servicio:desasignado', {
          id: servicioActualizado.id,
          mensaje: mensaje
        });
      }
    }

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

    // Emitir evento para todos los clientes conectados
    const emitServicioEvent = req.app.get('emitServicioEvent');
    if (emitServicioEvent) {
      emitServicioEvent('servicio:eliminado', { id, ...servicioInfo });
    }

    // Notificar específicamente al conductor asignado
    if (conductorId) {
      const emitServicioToUser = req.app.get('emitServicioToUser');
      if (emitServicioToUser) {
        emitServicioToUser(conductorId, 'servicio:eliminado', servicioInfo);
      }
    }

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
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre'] }
      ]
    });

    // Emitir evento para todos los clientes conectados
    const emitServicioEvent = req.app.get('emitServicioEvent');
    if (emitServicioEvent) {
      emitServicioEvent('servicio:estado-actualizado', {
        id: servicioActualizado.id,
        estado: servicioActualizado.estado,
        estadoAnterior,
        servicio: servicioActualizado
      });
    }

    // Notificar al conductor asignado
    if (servicio.conductor && servicio.conductor.id) {
      const emitServicioToUser = req.app.get('emitServicioToUser');
      if (emitServicioToUser) {
        emitServicioToUser(servicio.conductor.id, 'servicio:estado-actualizado', {
          id: servicioActualizado.id,
          estado: servicioActualizado.estado,
          estadoAnterior,
          mensaje: `El estado del servicio ha cambiado a ${estado}`
        });
      }
    }

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

    // Emitir evento para todos los clientes conectados
    const emitServicioEvent = req.app.get('emitServicioEvent');
    if (emitServicioEvent) {
      emitServicioEvent('servicio:numero-planilla-actualizado', {
        id: servicioActualizado.id,
        numero_planilla: servicioActualizado.numero_planilla,
        servicio: servicioActualizado
      });
    }

    // Notificar al conductor asignado
    if (servicio.conductor && servicio.conductor.id) {
      const emitServicioToUser = req.app.get('emitServicioToUser');
      if (emitServicioToUser) {
        emitServicioToUser(servicio.conductor.id, 'servicio:numero-planilla-actualizado', {
          id: servicioActualizado.id,
          estado: estadoActual,
          numero_planilla: servicioActualizado.numero_planilla,
          mensaje: `Se ha asignado el número de planilla ${numero_planilla} al servicio`
        });
      }
    }

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