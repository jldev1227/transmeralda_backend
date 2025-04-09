import json
import re
import sys
from datetime import datetime
import unicodedata

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

class RTMProcessor:
    def __init__(self, ocr_data):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.result = {
            "placa": None,
            "tecnomecanicaVencimiento": None,
        }
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def is_valid_rtm(self):
        """Verificar si el documento es una Revisión Técnico-Mecánica válida"""
        # Buscar términos clave de la RTM
        keywords = [
            "REVISIÓN TÉCNICO-MECÁNICA", "REVISION TECNICO-MECANICA", 
            "CERTIFICADO DE REVISIÓN", "MINISTERIO DE TRANSPORTE", 
            "RTM", "CENTRO DE DIAGNÓSTICO AUTOMOTOR"
        ]
        
        for keyword in keywords:
            if self.find_line_index(keyword) >= 0:
                return True
        return False
    
    def extract_placa(self):
        """Extraer la placa del vehículo"""
        placa_idx = self.find_line_index("PLACA")
        if placa_idx >= 0:
            # Buscar en esta línea y las siguientes
            for i in range(placa_idx, min(placa_idx + 5, len(self.lines))):
                match = re.search(r'[A-Z]{3}\d{3}', self.lines[i])
                if match:
                    self.result["placa"] = match.group(0)
                    return True
        
        # Si no encuentra con "PLACA", buscar patrón de placa en todas las líneas
        for line in self.lines:
            match = re.search(r'[A-Z]{3}\d{3}', line)
            if match:
                self.result["placa"] = match.group(0)
                return True
        
        return False
    
    def extract_fecha_vencimiento(self):
        """Extraer fecha de vencimiento de la RTM"""
        # Buscar términos relacionados con la fecha de vencimiento
        vencimiento_keywords = [
            "FECHA DE VENCIMIENTO", "VENCIMIENTO", "VIGENCIA HASTA", 
            "VÁLIDO HASTA", "VALIDO HASTA", "PRÓXIMA REVISIÓN",
            "PROXIMA REVISION"
        ]
        
        # 1. Primero buscar líneas que contengan palabras clave de vencimiento
        for keyword in vencimiento_keywords:
            venc_idx = self.find_line_index(keyword)
            if venc_idx >= 0:
                # Buscar una fecha en la misma línea o en las siguientes 3 líneas
                for i in range(venc_idx, min(venc_idx + 4, len(self.lines))):
                    line = self.lines[i]
                    
                    # Buscar fechas en formatos comunes
                    # Formato YYYY/MM/DD o YYYY-MM-DD
                    match = re.search(r'(20\d{2})[/-](\d{1,2})[/-](\d{1,2})', line)
                    if match:
                        year, month, day = match.groups()
                        try:
                            fecha = datetime(int(year), int(month), int(day))
                            self.result["tecnomecanicaVencimiento"] = fecha.strftime("%Y-%m-%d")
                            return True
                        except ValueError:
                            pass
                    
                    # Formato DD/MM/YYYY o DD-MM-YYYY
                    match = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](20\d{2})', line)
                    if match:
                        day, month, year = match.groups()
                        try:
                            fecha = datetime(int(year), int(month), int(day))
                            self.result["tecnomecanicaVencimiento"] = fecha.strftime("%Y-%m-%d")
                            return True
                        except ValueError:
                            pass
                    
                    # Formato YYYY/MM/DD sin separadores
                    match = re.search(r'20\d{2}\d{2}\d{2}', line)
                    if match:
                        date_str = match.group(0)
                        try:
                            year = int(date_str[:4])
                            month = int(date_str[4:6])
                            day = int(date_str[6:8])
                            fecha = datetime(year, month, day)
                            self.result["tecnomecanicaVencimiento"] = fecha.strftime("%Y-%m-%d")
                            return True
                        except ValueError:
                            pass
        
        # 2. Si no se encontró con palabras clave, buscar todas las fechas potenciales
        todas_fechas = []
        
        # Buscar fechas en cualquier línea
        for line in self.lines:
            # Formato YYYY/MM/DD o YYYY-MM-DD
            for match in re.finditer(r'(20\d{2})[/-](\d{1,2})[/-](\d{1,2})', line):
                year, month, day = match.groups()
                try:
                    fecha = datetime(int(year), int(month), int(day))
                    todas_fechas.append(fecha)
                except ValueError:
                    pass
            
            # Formato DD/MM/YYYY o DD-MM-YYYY
            for match in re.finditer(r'(\d{1,2})[/-](\d{1,2})[/-](20\d{2})', line):
                day, month, year = match.groups()
                try:
                    fecha = datetime(int(year), int(month), int(day))
                    todas_fechas.append(fecha)
                except ValueError:
                    pass
        
        # Seleccionar la fecha futura más cercana como vencimiento
        if todas_fechas:
            fecha_actual = datetime.now()
            fechas_futuras = [fecha for fecha in todas_fechas if fecha > fecha_actual]
            
            if fechas_futuras:
                # Si hay fechas futuras, tomar la más cercana
                fecha_vencimiento = min(fechas_futuras)
            else:
                # Si no hay fechas futuras, tomar la más reciente
                fecha_vencimiento = max(todas_fechas)
                
            self.result["tecnomecanicaVencimiento"] = fecha_vencimiento.strftime("%Y-%m-%d")
            return True
            
        return False
    
    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_rtm():
            return {"error": "No es una Revisión Técnico-Mecánica válida"}
        
        self.extract_placa()
        self.extract_fecha_vencimiento()
        
        return self.result

# Función principal para procesar el OCR
def process_rtm_data(data):
    try:
        processor = RTMProcessor(data)
        result = processor.process()
        return result
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}

# Ejecución principal
if __name__ == "__main__":
    try:
        # Leer datos del argumento o archivo
        if len(sys.argv) > 1:
            data = json.loads(sys.argv[1])
        else:
            with open('./src/utils/tempOcrDataTECNOMECANICA.json', 'r', encoding='utf-8') as file:
                data = json.load(file)
        
        # Procesar los datos
        result = process_rtm_data(data)
        
        # Imprimir resultado como JSON
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        import traceback
        print(json.dumps({"errr": str(e), "trace": traceback.format_exc()}))