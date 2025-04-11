const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs').promises;
const { Documento } = require('../models');
const logger = require('../utils/logger');
const { redisClient } = require('../config/redisClient');


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
 * Guarda un documento temporalmente en el sistema de archivos local
 * @param {Object} file - Objeto del archivo (buffer, filename, mimetype)
 * @param {string} sessionId - ID de la sesión
 * @param {string} categoria - Categoría del documento
 * @returns {Promise<string>} - Ruta al archivo guardado
 */

async function saveTemporaryDocument(file, sessionId, categoria) {

    console.log(file)
    try {
        // Crear directorio temporal si no existe
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.mkdir(tempDir, { recursive: true });

        // Generar nombre de archivo único
        const timestamp = Date.now();
        const filename = `${timestamp}-${categoria}-${file.filename || 'document.pdf'}`;
        const filePath = path.join(tempDir, filename);

        // Guardar el archivo
        await fs.writeFile(filePath, file.buffer);

        return {
            path: filePath,
            originalname: file.filename,
            mimetype: file.mimetype,
            size: file.buffer.length
        };
    } catch (error) {
        logger.error(`Error al guardar documento temporal: ${error.message}`);
        throw error;
    }
}

/**
 * Sube documentos finales a S3 después de procesar un vehículo exitosamente
 * @param {string} sessionId - ID de la sesión
 * @param {string} vehiculoId - ID del vehículo creado
 * @returns {Promise<Array>} - Array de documentos creados
 */
async function uploadProcessedDocuments(sessionId, vehiculoId) {
    const documentosCreados = [];
    const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);

    try {
        // Verificar que el directorio existe
        const exists = await fs.access(tempDir).then(() => true).catch(() => false);
        if (!exists) {
            logger.warn(`Directorio temporal no encontrado: ${tempDir}`);
            return documentosCreados;
        }

        // Obtener información de documentos desde Redis
        const fileInfoKeys = await redisClient.keys(`vehiculo:${sessionId}:files:*`);

        for (const key of fileInfoKeys) {
            try {
                // Extraer categoría del documento de la clave de Redis
                const categoria = key.split(':').pop();
                const fileInfoStr = await redisClient.get(key);

                if (!fileInfoStr) continue;

                const fileInfo = JSON.parse(fileInfoStr);

                // Verificar que tenemos la ruta del archivo
                if (!fileInfo.path) {
                    logger.warn(`No se encontró ruta para documento ${categoria}`);
                    continue;
                }

                // Leer el archivo
                const fileContent = await fs.readFile(fileInfo.path);

                // Generar ID único para el documento
                const documentId = uuidv4();

                // Generar ruta en S3
                const s3Key = `vehiculos/${vehiculoId}/documentos/${categoria}/${documentId}${path.extname(fileInfo.originalname || 'documento.pdf')}`;

                // Subir a S3
                const upload = new Upload({
                    client: s3Client,
                    params: {
                        Bucket: BUCKET_NAME,
                        Key: s3Key,
                        Body: fileContent,
                        ContentType: fileInfo.mimetype || 'application/octet-stream'
                    }
                });

                await upload.done();

                // Crear registro en la base de datos
                const documento = await Documento.create({
                    id: documentId,
                    vehiculo_id: vehiculoId,
                    documentType: categoria,
                    s3Key: s3Key,
                    filename: fileInfo.originalname || `${categoria}.pdf`,
                    mimetype: fileInfo.mimetype || 'application/octet-stream',
                    uploadDate: new Date(),
                    metadata: {
                        size: fileInfo.size || 0,
                        bucket: BUCKET_NAME
                    }
                });

                documentosCreados.push(documento);
                logger.info(`Documento ${categoria} subido exitosamente a S3 para vehículo ${vehiculoId}`);
            } catch (error) {
                logger.error(`Error al procesar documento para subida final: ${error.message}`);
                // Continuar con el siguiente documento
            }
        }

        // Limpiar directorio temporal después de procesar todos los documentos
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal eliminado: ${tempDir}`);

        return documentosCreados;
    } catch (error) {
        logger.error(`Error al subir documentos procesados: ${error.message}`);
        // Intentar eliminar directorio temporal incluso si hay error
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
            logger.error(`Error al limpiar directorio temporal: ${cleanupError.message}`);
        }
        throw error;
    }
}

module.exports = {
    saveTemporaryDocument,
    uploadProcessedDocuments
};