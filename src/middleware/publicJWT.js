const jwt = require('jsonwebtoken'); // ← ESTO FALTABA

// Generar JWT público
const generarJWTPublico = (servicioId) => {
    return jwt.sign(
        { 
            type: 'public_access',
            servicio_id: servicioId,
            permissions: ['read']
        },
        process.env.JWT_SECRET
    );
};

// Middleware
const validatePublicJWT = (req, res, next) => {
    const { token } = req.query;
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.type !== 'public_access') {
            return res.status(401).json({ error: 'Token inválido' });
        }
        
        req.publicAccess = true;
        req.servicioId = decoded.servicio_id;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

module.exports = {
    generarJWTPublico,
    validatePublicJWT
};