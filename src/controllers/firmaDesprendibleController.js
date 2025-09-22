const { FirmaDesprendible, Liquidacion, Conductor } = require('../models');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// Cliente S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'transmeralda';

/**
 * Subir firma a S3
 */
const uploadSignatureToS3 = async (signatureDataURL, liquidacionId, conductorId) => {
    try {
        // Extraer el tipo de imagen y los datos base64
        const matches = signatureDataURL.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
        
        if (!matches) {
            throw new Error('Formato de imagen inválido');
        }
        
        const imageType = matches[1]; // png, jpeg, etc.
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generar clave única para S3
        const timestamp = Date.now();
        const randomString = crypto.randomBytes(8).toString('hex');
        const key = `firmas/${conductorId}/${liquidacionId}-${timestamp}-${randomString}.${imageType}`;
        
        // Configurar parámetros para S3
        const putObjectParams = {
            Bucket: BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: `image/${imageType}`,
            ContentEncoding: 'base64',
            ServerSideEncryption: 'AES256',
            Metadata: {
                'liquidacion-id': liquidacionId,
                'conductor-id': conductorId,
                'upload-timestamp': timestamp.toString()
            }
        };
        
        // Subir a S3
        const command = new PutObjectCommand(putObjectParams);
        await s3Client.send(command);
        
        // Construir URL pública (opcional, depende de tu configuración de bucket)
        const url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-2'}.amazonaws.com/${key}`;
        
        return {
            url,
            key,
            size: buffer.length,
            contentType: `image/${imageType}`
        };
        
    } catch (error) {
        console.error('Error subiendo firma a S3:', error);
        throw new Error(`Error al subir firma: ${error.message}`);
    }
};

/**
 * Crear nueva firma de desprendible
 */
const crearFirma = async (req, res) => {
    const transaction = await FirmaDesprendible.sequelize.transaction();
    
    try {
        const { signatureData, conductorId, liquidacionId } = req.body;

        // Validaciones básicas
        if (!signatureData) {
            return res.status(400).json({
                success: false,
                message: 'Los datos de la firma son obligatorios'
            });
        }
        
        if (!conductorId) {
            return res.status(400).json({
                success: false,
                message: 'El ID del conductor es obligatorio'
            });
        }

        // Verificar que existe la liquidación
        const liquidacion = await Liquidacion.findByPk(liquidacionId, {
            include: [
                {
                    model: Conductor,
                    as: 'conductor',
                    attributes: ['id', 'nombre', 'apellido', 'numero_identificacion']
                }
            ],
            transaction
        });

        if (!liquidacion) {
            return res.status(404).json({
                success: false,
                message: 'Liquidación no encontrada'
            });
        }
        
        // Verificar que el conductor coincide con la liquidación
        if (liquidacion.conductor_id !== conductorId) {
            return res.status(403).json({
                success: false,
                message: 'El conductor no corresponde a esta liquidación'
            });
        }
        
        // Verificar si ya existe una firma para esta liquidación
        const firmaExistente = await FirmaDesprendible.findOne({
            where: {
                liquidacion_id: liquidacionId,
                conductor_id: conductorId,
                estado: 'Activa'
            },
            transaction
        });
        
        if (firmaExistente) {
            return res.status(409).json({
                success: false,
                message: 'Ya existe una firma activa para esta liquidación',
                data: {
                    firmaId: firmaExistente.id,
                    fechaFirma: firmaExistente.fecha_firma
                }
            });
        }
        
        // Subir firma a S3
        const s3Result = await uploadSignatureToS3(signatureData, liquidacionId, conductorId);
        
        // Generar hash de la firma para verificación de integridad
        const hashFirma = crypto.createHash('sha256').update(signatureData).digest('hex');
        
        // Crear registro en base de datos
        const nuevaFirma = await FirmaDesprendible.create({
            liquidacion_id: liquidacionId,
            conductor_id: conductorId,
            firma_url: s3Result.url,
            firma_s3_key: s3Result.key,
            hash_firma: hashFirma,
            ip_address: req.ip || req.connection.remoteAddress,
            user_agent: req.headers['user-agent'],
            observaciones: `Firma creada automáticamente. Tamaño: ${s3Result.size} bytes`,
            creado_por_id: req.user?.id || null
        }, {
            transaction,
            user: req.user,
            req: req,
            signatureData: signatureData
        });
        
        await transaction.commit();
        
        // Respuesta exitosa
        res.status(201).json({
            success: true,
            message: 'Firma registrada exitosamente',
            data: {
                firmaId: nuevaFirma.id,
                liquidacionId: liquidacionId,
                conductorId: conductorId,
                fechaFirma: nuevaFirma.fecha_firma,
                s3Key: s3Result.key,
                hashIntegridad: hashFirma,
                conductor: {
                    nombre: liquidacion.conductor.nombre,
                    apellido: liquidacion.conductor.apellido,
                    identificacion: liquidacion.conductor.numero_identificacion
                },
                liquidacion: {
                    periodo_start: liquidacion.periodo_start,
                    periodo_end: liquidacion.periodo_end,
                    estado: liquidacion.estado
                }
            }
        });
        
    } catch (error) {
        await transaction.rollback();
        console.error('Error creando firma:', error);
        
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor al crear la firma',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Obtener firma por ID con URL firmada
 */
const obtenerFirma = async (req, res) => {
    try {
        const { firmaId } = req.params;
        
        const firma = await FirmaDesprendible.findByPk(firmaId, {
            include: [
                {
                    model: Liquidacion,
                    as: 'liquidacion',
                    attributes: ['id', 'periodo_start', 'periodo_end', 'estado']
                },
                {
                    model: Conductor,
                    as: 'conductor',
                    attributes: ['id', 'nombre', 'apellido', 'numero_identificacion']
                }
            ]
        });
        
        if (!firma) {
            return res.status(404).json({
                success: false,
                message: 'Firma no encontrada'
            });
        }
        
        // Generar URL firmada para acceso temporal (válida por 1 hora)
        let urlFirmada = null;
        if (firma.firma_s3_key) {
            const getObjectParams = {
                Bucket: BUCKET_NAME,
                Key: firma.firma_s3_key
            };
            
            const command = new GetObjectCommand(getObjectParams);
            urlFirmada = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hora
        }
        
        res.json({
            success: true,
            data: {
                ...firma.toJSON(),
                url_firmada_temporal: urlFirmada
            }
        });
        
    } catch (error) {
        console.error('Error obteniendo firma:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener la firma',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Obtener firmas por liquidación
 */
const obtenerFirmasPorLiquidacion = async (req, res) => {
    try {
        const { liquidacionId } = req.params;
        
        const firmas = await FirmaDesprendible.findAll({
            where: {
                liquidacion_id: liquidacionId
            },
            include: [
                {
                    model: Conductor,
                    as: 'conductor',
                    attributes: ['id', 'nombre', 'apellido', 'numero_identificacion']
                }
            ],
            order: [['fecha_firma', 'DESC']]
        });
        
        res.json({
            success: true,
            data: firmas,
            total: firmas.length
        });
        
    } catch (error) {
        console.error('Error obteniendo firmas por liquidación:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener las firmas',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Revocar una firma
 */
const revocarFirma = async (req, res) => {
    try {
        const { firmaId } = req.params;
        const { motivo } = req.body;
        
        const firma = await FirmaDesprendible.findByPk(firmaId);
        
        if (!firma) {
            return res.status(404).json({
                success: false,
                message: 'Firma no encontrada'
            });
        }
        
        if (firma.estado === 'Revocada') {
            return res.status(400).json({
                success: false,
                message: 'La firma ya está revocada'
            });
        }
        
        await firma.update({
            estado: 'Revocada',
            observaciones: `${firma.observaciones || ''}\nRevocada: ${motivo || 'Sin motivo especificado'}`,
            actualizado_por_id: req.user?.id
        });
        
        res.json({
            success: true,
            message: 'Firma revocada exitosamente',
            data: {
                firmaId: firma.id,
                estadoAnterior: 'Activa',
                estadoActual: 'Revocada',
                fechaRevocacion: new Date()
            }
        });
        
    } catch (error) {
        console.error('Error revocando firma:', error);
        res.status(500).json({
            success: false,
            message: 'Error al revocar la firma',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    crearFirma,
    obtenerFirma,
    obtenerFirmasPorLiquidacion,
    revocarFirma
};