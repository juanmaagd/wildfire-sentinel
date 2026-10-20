# 14 — Cómo funciona Wildfire Sentinel (guía en español)

Guía para entender y explicar el sistema. Todo lo que dice aquí está en el código (`app/sentinel/`); los números son medidos.

---

## 1. La idea en 30 segundos

Los satélites de la NASA detectan **puntos de calor** en Japón todos los días. La mayoría no son incendios: son **acerías, fábricas y refinerías** que siempre emiten calor. El sistema:

1. Recibe los puntos de calor del satélite (NASA FIRMS).
2. Mira la **foto aérea** de cada punto y decide en ~0,2 s si hay una fábrica o vegetación (**Jev**).
3. Si parece un incendio, lanza la **alerta** al instante y hace un análisis más profundo.
4. **Predice cómo se propagaría** el fuego en 3D con el clima por hora.
5. Permite **probar un plan de respuesta** (línea de cortafuegos, cuadrillas) y ver cuánto reduce el incendio.
6. **ai&** escribe el informe y las tácticas en japonés e inglés.
7. **Neo4j** recuerda cada sitio y cada veredicto, y guarda cada incendio como un **grafo** de cómo se propagó.

---

## 1b. Qué servicios usamos (y para qué)

El sistema combina **datos públicos** (gratis, la mayoría sin clave) con **tres modelos/servicios de IA y base de datos**.

### Datos

| Servicio | Quién lo da | Qué nos da | Cómo lo usamos |
| --- | --- | --- | --- |
| **FIRMS** (Fire Information for Resource Management System) | NASA | La lista de **puntos de calor** detectados por satélite: posición, hora, intensidad (FRP) y satélite. | Es la **entrada de todo**. Se pide por internet un CSV de una zona (un rectángulo de coordenadas) con nuestra clave. **Live:** los últimos 2 días en todo Japón, en tiempo casi real (≈3 h de retraso). **Replay:** el archivo histórico de Ofunato, combinando 3 satélites (NOAA-20, NOAA-21 y Suomi NPP), porque uno solo se pierde días del incendio. |
| **GIBS** (Global Imagery Browse Services) | NASA | La **imagen satelital en color real** del día (como una foto desde el espacio). | Es la tercera imagen que mira Jev en el análisis profundo (humo, nubes). Sin clave. Es opcional: si falla, el análisis sigue. |
| **Fotos aéreas GSI** | Instituto Geográfico de Japón (国土地理院) | **Fotos aéreas** de todo Japón, muy detalladas (se ven casas y fábricas). | Es lo que mira **Jev** para decidir si hay fábrica o bosque. También es el fondo del mapa 3D. Si no hay foto (error 404), el punto está **fuera de Japón** y se descarta. Las fotos son de archivo, no del día. |
| **Terrain Tiles** (formato terrarium) | AWS Open Data | El **mapa de elevación** del terreno (la altura de cada punto). | Para la **pendiente** en la predicción y para el **relieve 3D**. Sin clave. |
| **Open-Meteo** | Servicio meteorológico abierto | **Clima hora por hora:** viento, dirección, ráfagas, humedad, temperatura, lluvia. Tiene pronóstico y archivo histórico. | Las **puntuaciones** (viento, humedad, días sin lluvia) y la **predicción** (7 días hora por hora). Live y Drill usan el pronóstico; Replay, el clima real de esos días. Sin clave. |

**La relación con la NASA en una frase:** la NASA nos dice **dónde hay calor** (FIRMS) y cómo se veía el día desde el espacio (GIBS). Todo lo demás (qué hay en ese lugar, si es incendio, cómo se propagaría) lo agregamos nosotros.

**Por qué el satélite solo no alcanza:** FIRMS ve calor, no distingue una acería de un bosque. Por eso hace falta la foto aérea y Jev.

### IA y base de datos

| Servicio | Qué es | Para qué lo usamos |
| --- | --- | --- |
| **TypeSafe Jev** | Modelo de IA muy rápido que responde preguntas cerradas sobre imágenes con probabilidades (no es sponsor). | Decidir si un punto es fábrica o posible incendio (etapa 1) y el análisis profundo (etapa 2). |
| **ai&** (sponsor) | Plataforma japonesa de IA con API compatible con OpenAI; corre en GPUs en Japón. | Redactar el informe de situación y el plan táctico, en japonés e inglés. |
| **Neo4j** (sponsor) | Base de datos de grafos. Corre en local con Docker. | La memoria del agente (sitios y veredictos) y el grafo de propagación de cada incendio. |

### Para dibujar

- **MapLibre:** la librería que dibuja el mapa 2D y el 3D en el navegador.
- **NVL:** la librería de Neo4j que dibuja el grafo.

---

## 2. Qué significan los colores del mapa

| En el mapa | Significa |
| --- | --- |
| **Punto rojo** | Posible incendio: calor en una zona con vegetación y sin industria cerca. Genera alerta. |
| **Punto gris claro** | Industria: hay una fábrica a menos de ~400 m. Se filtra, no es alerta. |
| **Punto gris oscuro** | Agua u otro (mar, zona sin vegetación ni industria). |
| **Anillo lima** | El veredicto salió de la **memoria de Neo4j** (el sitio ya era conocido), sin llamar a Jev. |
| **Mancha roja con borde** | Un **incendio** (incidente): varias detecciones a menos de 2 km unidas. Rojo = activo. Gris = extinguido (sin detecciones desde hace más de un día). |
| **Halo que late** | Incendio activo. |

Importante: el satélite **ya dice que hay calor**. Jev no "ve el fuego": juzga **qué hay en ese lugar** (fábrica, bosque, casas, agua). Calor + bosque + sin fábrica = posible incendio.

---

## 3. Cómo decide Jev si es incendio o no

**Jev** (TypeSafe) es un modelo muy rápido que responde preguntas cerradas sobre imágenes con probabilidades. No escribe texto: devuelve números. Eso lo hace barato y rápido (~150–300 ms).

### Etapa 1: la alerta (una llamada por punto)

1. Se descarga la **foto aérea oficial de Japón (GSI)** centrada exactamente en el punto, de 768 × 768 píxeles.
2. Jev responde cuatro preguntas de sí/no con una probabilidad de 0 a 1:
   - ¿Hay instalaciones industriales a menos de ~400 m?
   - ¿Hay vegetación cerca?
   - ¿Hay casas cerca?
   - ¿El centro es agua abierta?
3. Una **regla en código** (no el modelo) decide:
   - industria ≥ 0,5 → **industrial** (se filtra);
   - si no, vegetación ≥ 0,5 → **posible incendio** (alerta);
   - si no, agua ≥ 0,5 → **agua**;
   - si no → **otro**.

**¿Por qué "a menos de 400 m" y no "en el centro"?** Porque el satélite VIIRS tiene un error de posición de ~375 m. El punto de calor de una acería a veces cae en el mar o en el bosque de al lado. Por eso preguntamos por el **vecindario**, no por el píxel exacto.

**Si el punto está fuera de Japón** (no hay foto GSI), se descarta sin llamar a Jev.

### Etapa 2: el análisis profundo (solo para alertas)

Una sola llamada con **tres imágenes** (foto cercana, foto amplia de ~7 km y la imagen satelital del día) y unas diez preguntas en paralelo:

- tipo de combustible (bosque de coníferas, bosque mixto, pasto o matorral, cultivos, zona urbana);
- continuidad de la vegetación;
- distancia, dirección y tamaño del poblado más cercano;
- terreno (llano, colinas, montaña);
- cortafuegos naturales (ríos, caminos);
- fuente de agua cercana;
- humo visible; nubes.

### Las puntuaciones (1 a 5)

El **código** combina las respuestas de Jev con el **clima** (viento, ráfagas, humedad, días sin lluvia) y los datos del satélite (intensidad del fuego, cantidad de detecciones). Así calcula **peligro, riesgo de propagación, exposición y urgencia**. También decide si las casas están **a sotavento** (el viento sopla hacia ellas).

Las acciones recomendadas también salen de reglas. Por ejemplo, la evacuación aparece solo si el peligro es ≥ 4 y la exposición es ≥ 3.

**Regla de oro del sistema:** los modelos de IA nunca inventan números ni horas. Los números salen del código; la IA solo responde preguntas (Jev) o redacta texto (ai&).

---

## 4. Cómo usamos Neo4j (dos usos distintos)

### Uso 1: memoria del agente (Neo4j Agent Memory)

- Cada lugar juzgado se guarda como una **entidad de tipo ubicación con coordenadas**.
- Cada veredicto se guarda como un **rastro de razonamiento** (*reasoning trace*): qué se pensó, qué herramienta se llamó (Jev), con qué datos y qué respondió.
- **Antes de llamar a Jev**, el sistema pregunta a la memoria: "¿conozco algún sitio a menos de 1 km?". Si lo conoce, reutiliza el veredicto **sin llamar al modelo** (el anillo lima del mapa).
- Resultado medido: en la segunda pasada por la misma zona, el 100 % de los sitios salió de memoria y hubo 0 llamadas a Jev.
- En el Replay de Ofunato se borra la memoria de esa zona al empezar, para que en el demo se vea a Jev trabajando.

### Uso 2: el grafo de propagación del incendio

Se explica en la sección siguiente.

---

## 5. El grafo del incendio, explicado simple

### La idea: un árbol genealógico del fuego

Imagina que cada vez que el satélite ve un punto de calor, eso es una **persona**. El grafo responde: **¿de qué punto anterior "nació" cada punto?** Así se arma un **árbol genealógico** del incendio.

### Cómo se construye

1. **Nodos de detección:** cada detección satelital del incendio (en Ofunato, 255 en 9 días, de 3 satélites).
2. **Relación `SPREAD_TO` ("se propagó a"):** para cada detección, se busca la detección **más cercana** vista **en un pase anterior** del satélite. Las condiciones:
   - al menos 1 h antes (dos satélites que pasan con minutos de diferencia ven el mismo momento, no propagación);
   - como máximo 48 h antes;
   - a menos de 2 km.

   Esa detección anterior es su **"madre"**, y se dibuja una flecha de la madre a la hija. En Ofunato salen 227 flechas.
3. **Nodos de día:** cada día del incendio, encadenados (`NEXT`), con la lluvia de ese día. Cada detección cuelga de su día.
4. **Enlace con la memoria:** cada detección se une al sitio que Jev juzgó en esa zona (`SEEN_AT`). Así el grafo del incendio y la memoria del agente viven en la **misma base de datos**.

### Qué preguntas responde (cada una es una consulta Cypher)

| Pregunta | Cómo se responde en el grafo | Ofunato |
| --- | --- | --- |
| ¿Dónde empezó? | Detecciones **sin madre** al principio | 23 puntos en el primer avistamiento: el fuego ya era grande cuando lo vio el satélite |
| ¿Aparecieron focos nuevos? | Detecciones **sin madre** que aparecen **más tarde** | 2 frentes nuevos (+49 h y +131 h): saltos o pavesas que encendieron fuego a más de 2 km del frente |
| ¿Por dónde avanzó más? | La cadena madre → hija → nieta… **más larga** | 8 saltos, 4,5 km, en 119 h |
| ¿Cuál fue el punto clave? | El nodo con **más descendientes** | Un punto visto en la primera hora tiene 82 detecciones "descendientes": era la rama principal |
| ¿Cuál fue la carrera más rápida? | La flecha con más km por hora | 0,91 km en 1,3 h |

### En la pantalla

- **Color de cada punto:** de amarillo (primeras horas) a rojo oscuro (días después).
- **Tamaño de cada punto:** la intensidad del fuego (FRP, en megavatios).
- **Nodos blancos:** los días; en **azul** si llovió (el 5 de marzo cayeron 25,9 mm y el fuego se apagó).
- **Nodos lima:** los sitios de Jev en la memoria.
- **Al hacer click** en un hallazgo del panel derecho, se ilumina esa parte del grafo y el resto se apaga.

### Cómo explicarlo en 20 segundos

> "En Neo4j cada detección del satélite está unida a la detección anterior más cercana de la que probablemente salió. Así el incendio queda como un árbol. Con consultas sobre el grafo vemos dónde empezó, la rama principal (82 detecciones salen de un solo punto de la primera hora: controlarlo temprano cortaba esa rama) y dos frentes nuevos que saltaron más de 2 km."

### Lo honesto (por si preguntan)

La relación "madre → hija" es una **inferencia por cercanía en el espacio y el tiempo**, no una prueba física de que el fuego pasó por ahí. Es la forma estándar de reconstruir la propagación con datos satelitales, pero sigue siendo una aproximación.

---

## 6. La predicción, paso a paso

**Corrección importante:** la predicción **no se hace a partir de una imagen**. La foto aérea la usa Jev para decidir el tipo de combustible; la foto en 3D es solo para que se vea el terreno. La predicción es un **modelo físico simplificado** que usa estos ingredientes:

| Ingrediente | De dónde sale |
| --- | --- |
| **Punto(s) de inicio** | La alerta. En Replay: todas las detecciones del **primer pase del satélite** (el fuego ya tenía varios focos). |
| **Terreno** | Un mapa de elevación (DEM) de ~45 × 45 km dividido en celdas de ~180 m. |
| **Combustible** | El mapa de vegetación de la ESA (WorldCover, todo el mundo) celda por celda: bosque, matorral, pasto, cultivos, ciudad, suelo desnudo, agua. Si no se puede leer, se usa lo que respondió Jev para toda la zona. |
| **Clima hora por hora, 7 días** | Open-Meteo: viento, dirección, ráfagas, temperatura, humedad, lluvia. En Replay es el **clima histórico real** de esos días; en Live y Drill es el **pronóstico** desde ahora. |

### Las reglas del modelo

1. **Velocidad base:** depende del combustible de cada celda y de la **humedad del combustible**, que cambia hora a hora: se seca con calor y aire seco, se moja con la lluvia y tarda unas horas en volver a secarse. La lluvia de los últimos 7 días también cuenta. Más viento significa más velocidad.
2. **Forma de elipse:** el fuego avanza rápido **a favor del viento** (la "cabeza"), lento hacia los costados (los "flancos") y muy lento hacia atrás (la "cola"). Con más viento, la elipse es más alargada.
3. **Pendiente:** cuesta arriba el fuego va más rápido (se duplica cada ~10° de inclinación); cuesta abajo, más lento.
4. **Lluvia:** una lluvia corta (o una tormenta seca) frena el fuego unas horas; una lluvia fuerte lo detiene hasta que el combustible se seca.
5. **El mar, los lagos y la nieve no arden;** cultivos, ciudad y suelo desnudo frenan el fuego.
6. **El clima cambia cada hora:** el fuego usa el viento y la humedad de la hora en la que llega a cada lugar.

### Cómo se calcula: como un GPS

El modelo calcula, para **cada celda del terreno**, **cuánto tarda el fuego en llegar**. Funciona como un GPS que busca la ruta más rápida, pero el "tráfico" es el viento, la pendiente y el combustible. Después:

- el perímetro a las +3 h son todas las celdas a las que el fuego llega en 3 h o menos;
- lo mismo para +6, +12, +24, +48, +72, +96, +120 y +168 h.

### En la pantalla

- Los colores van de amarillo (primeras horas) a rojo oscuro.
- Lo que se quemó hace más de 24 h se ve como **cicatriz oscura**.
- Abajo está el **gráfico del clima**: viento, humedad y lluvia hora por hora, con las bandas azules de lluvia y el slider para moverse en el tiempo.

### ¿Funciona? La comprobación con la realidad (Replay)

En Ofunato arrancamos la predicción con el primer pase del satélite (27/02, 00:52) y la comparamos con la **superficie quemada oficial** en los mismos momentos (panel **"Reality check"** de la vista 3D):

| Momento | Oficial | Predicción |
| --- | --- | --- |
| +30 h (28/02 a la mañana, NHK) | 1.200 ha | 3.800–4.200 ha (×3,2–3,5) |
| 03/03 (Yomiuri) | 2.100 ha | ~×4,5–5,5 |
| 05/03 6:00 (Iwate) | 2.900 ha | ~×5,5 |
| Final (ciudad de Ofunato) | 3.370 ha | ~×4,8 |

- La predicción es el incendio **sin bomberos**; las cifras oficiales incluyen la extinción, así que la diferencia es lo que salvaron los bomberos más el error del modelo. El rango a +30 h depende del hotspot que abras.
- La velocidad del modelo (`SPEED = 1,0`) se **calibró con 18 incendios de 9 países**, comparando las primeras 30 h con lo que vio el satélite (`docs/16-spread-calibration.md`). En los 6 incendios que no se usaron para ajustar, encuentra el 67 % del fuego (el primer modelo, 33 %). Es un modelo simple, no un simulador profesional como FARSITE.
- En el Replay se usa el combustible con el que se calibró (bosque de coníferas). La foto de un solo punto no representa un incendio de 3.000 ha.

---

## 7. El plan de respuesta

Un bombero no apaga un incendio forestal "con una manguera": arma una **estrategia** según el terreno y el clima. El plan funciona así:

1. Mueves el slider a la **hora en que decides** (por ejemplo +6 h) y pides el plan.
2. El sistema calcula **dónde va a estar el frente 3 horas después**. Ese es el tiempo que necesita una cuadrilla para cortar la línea.
3. Ahí traza una **línea de control (cortafuegos)**, una franja sin vegetación, sobre la cabeza y los flancos del fuego.
   - Si el pronóstico trae un **giro de viento de 60° o más**, la línea **rodea todo el fuego**, porque la cola puede convertirse en cabeza.
4. **Vuelve a simular** el incendio con esa franja sin combustible y compara: sin intervención frente a con plan.
5. Calcula el **largo de la línea** y las **cuadrillas** necesarias para terminarla a tiempo (manuales a ~0,3 km/h, topadoras a ~1 km/h).
6. **ai&** escribe las tácticas **a partir de esos números**: punto de anclaje, línea de control, ataque directo, helicópteros, protección de casas y seguridad de la cuadrilla (LCES: vigías, comunicaciones, rutas de escape, zonas seguras).
7. Cada plan queda en el timeline como **P1, P2…**, así se comparan decisiones tomadas a distintas horas.

**El mensaje:** decidir temprano necesita una línea corta y pocas cuadrillas, y contiene el fuego. Decidir tarde necesita más de todo y el fuego termina más grande. En Ofunato, un incendio extremo, una sola línea no alcanza (17 cuadrillas y solo se reduce a la mitad).

**Limitaciones:** el modelo no conoce caminos ni ríos, y las tasas de las cuadrillas son valores típicos.

---

## 8. ai&: qué escribe y qué no

- **Informe de situación** (bajo demanda, ~5–11 s): titular, resumen en japonés e inglés, explicación de cada puntuación, evidencia y lo que no se sabe.
- **Plan táctico** (bajo demanda, ~6–7 s).
- Usa el modelo `deepseek-v4-flash` con **JSON estricto**: siempre devuelve los mismos campos.
- Recibe **etiquetas** ("pasto o matorral"), no números de escala, y solo la hora en JST. Así no inventa unidades ni mezcla zonas horarias.
- ai& corre en GPUs en Japón: los datos quedan en Japón.

---

## 9. Los tres modos

| Modo | Qué muestra |
| --- | --- |
| **Live** | Los puntos de calor reales de hoy en todo Japón. Casi todo es industria (77 % de los sitios en la prueba). |
| **Drill · Ashikaga** | Un incendio de matorral cotidiano en la ladera sobre el centro de Ashikaga (donde ardió el monte Ryōgai en 2021), con el **pronóstico de hoy**. Alerta en 0,6 s y análisis completo en 3,3 s. Es un simulacro: el lugar y el clima son reales, el foco no. |
| **Replay · Ofunato** | El incendio de Ofunato (febrero–marzo de 2025, ~2.900 ha), día por día durante 9 días, desde la ignición hasta la lluvia que lo apagó. Usa datos reales de archivo de tres satélites. |

---

## 10. Glosario

- **FIRMS:** servicio de la NASA que publica los puntos de calor detectados por satélite.
- **VIIRS:** el sensor de los satélites NOAA-20, NOAA-21 y Suomi NPP. Cada píxel mide ~375 m.
- **FRP (Fire Radiative Power):** cuánta energía emite el punto de calor, en megavatios. Indica la intensidad del fuego.
- **GSI:** el instituto geográfico de Japón; publica las fotos aéreas.
- **DEM:** mapa de elevación del terreno.
- **Pase:** cada vez que un satélite pasa por encima y toma datos (unas pocas veces al día).
- **Isócrona:** la línea de lugares a los que el fuego llega en el mismo tiempo.
- **Cabeza / flancos / cola:** el frente que avanza con el viento, los costados y la parte de atrás del incendio.
- **Línea de control / cortafuegos:** franja donde se quita la vegetación para que el fuego no pueda cruzar.
- **Reasoning trace:** registro de cómo el agente llegó a una decisión (qué herramienta usó y qué respondió).
- **Cypher:** el lenguaje de consultas de Neo4j.
- **NVL:** la librería oficial de Neo4j para dibujar grafos en la web.
