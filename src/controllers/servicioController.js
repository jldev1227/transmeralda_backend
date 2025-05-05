const { Servicio, Municipio, Conductor, Vehiculo, Empresa } = require('../models');

// Obtener todos los servicios
exports.obtenerTodos = async (req, res) => {
  try {
    const servicios = await Servicio.findAll({
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo', "marca", "linea"] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre', "NIT", "requiere_osi"] }
      ]
    });

    return res.status(200).json({
      success: true,
      data: servicios,
      total: servicios.length
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
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion', 'tipo_identificacion'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre', 'NIT'] }
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

    console.log(req.body)

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
    });

    // Obtener el servicio con sus relaciones
    const servicioCreado = await Servicio.findByPk(nuevoServicio.id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'linea', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre'] }
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
  console.log(req.body)
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

    // Si se cambiaron IDs de referencia, verificar que existan
    const promises = [];
    if (origen_id && origen_id !== servicio.origen_id) {
      promises.push(Municipio.findByPk(origen_id));
    }

    if (destino_id && destino_id !== servicio.destino_id) {
      promises.push(Municipio.findByPk(destino_id));
    }

    if (conductor_id && conductor_id !== servicio.conductor_id) {
      promises.push(Conductor.findByPk(conductor_id));
    }

    if (vehiculo_id && vehiculo_id !== servicio.vehiculo_id) {
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

    // Actualizar el servicio
    await servicio.update({
      origen_id: origen_id || servicio.origen_id,
      destino_id: destino_id || servicio.destino_id,
      origen_especifico: origen_especifico || servicio.origen_especifico,
      destino_especifico: destino_especifico || servicio.destino_especifico,
      origen_latitud: origen_latitud !== undefined ? origen_latitud : servicio.origen_latitud,
      origen_longitud: origen_longitud !== undefined ? origen_longitud : servicio.origen_longitud,
      destino_latitud: destino_latitud !== undefined ? destino_latitud : servicio.destino_latitud,
      destino_longitud: destino_longitud !== undefined ? destino_longitud : servicio.destino_longitud,
      conductor_id: conductor_id || servicio.conductor_id,
      vehiculo_id: vehiculo_id || servicio.vehiculo_id,
      cliente_id: cliente_id || servicio.cliente_id,
      estado: estado || servicio.estado,
      proposito_servicio: proposito_servicio || servicio.proposito_servicio,
      fecha_solicitud: fecha_solicitud || servicio.fecha_solicitud,
      fecha_realizacion: fecha_realizacion || servicio.fecha_realizacion,
      valor: valor || servicio.valor,
      observaciones: observaciones !== undefined ? observaciones : servicio.observaciones
    });

    // Obtener el servicio actualizado con sus relaciones
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'linea', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre'] }
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
      // Notificar al conductor nuevo
      if (conductor_id && conductor_id !== conductorAnteriorId) {
        emitServicioToUser(conductor_id, 'servicio:asignado', servicioActualizado);
      }

      // Notificar al conductor anterior que se le ha quitado el servicio
      if (conductorAnteriorId && conductor_id !== conductorAnteriorId) {
        emitServicioToUser(conductorAnteriorId, 'servicio:desasignado', {
          id: servicioActualizado.id,
          mensaje: 'Este servicio ya no está asignado a usted'
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
    await servicio.destroy();

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
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'nombre'] }
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
    const { estado } = req.body;

    console.log(req.body)

    if (!estado || !['en_curso', 'realizado', 'planificado', 'realizado', 'cancelado'].includes(estado)) {
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

    // Actualizar solo el estado y registrar fecha de finalización si se completa
    const datosActualizacion = { estado };

    if (estado === 'COMPLETADO' || estado === 'REALIZADO') {
      datosActualizacion.fecha_realizacion = new Date();
    }

    await servicio.update(datosActualizacion);

    // Obtener el servicio actualizado
    const servicioActualizado = await Servicio.findByPk(id, {
      include: [
        { model: Municipio, as: 'origen', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Municipio, as: 'destino', attributes: ['id', 'nombre_municipio', 'nombre_departamento'] },
        { model: Conductor, as: 'conductor', attributes: ['id', 'nombre'] },
        { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'modelo'] },
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre'] }
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
    const user_id = req.usuario.id; // Asumiendo que tienes middleware de autenticación

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
        { model: Empresa, as: 'cliente', attributes: ['id', 'Nombre'] }
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