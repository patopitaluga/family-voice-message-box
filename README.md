# Family Voice Message Box

## Índice

- [Cómo funciona](#cómo-funciona)
- [Por qué existe](#por-qué-existe)
- [En este repositorio](#en-este-repositorio)
- [Cómo empezar](#cómo-empezar)
- [Estado](#estado)
- [Licencia](#licencia)

------

![Mockup de la caja de mensajes de voz](docs/mockup.png)

*Mockup provisional — se reemplazará por una foto del proyecto real.*

Una caja con un botón. Eso es todo lo que necesita un niño para hablar con su familia.

Pulsa, habla y envía un mensaje de voz al grupo de Telegram de la familia. Cuando llegan las respuestas, la caja las reproduce. Sin pantallas, sin apps, sin depender de un teléfono.

Diseñada para acompañarlo donde esté: funciona con batería y no necesita estar enchufada.

------

## Cómo funciona

1. **Pulsa** el botón y habla.
2. **Suéltalo** para enviar el mensaje al grupo familiar.
3. **Escucha** cuando la familia responde.

Simple para el niño. Cercano para todos.

------

## Por qué existe

Los más pequeños también quieren estar en contacto — pero un teléfono no es para ellos. Esta caja les da una forma propia de decir “hola”, contar algo o pedir un abrazo a distancia, sin pantallas ni distracciones.

------

## En este repositorio

El software y el diseño de la **Family Voice Message Box**: un proyecto open source pensado para armar en casa, adaptar a tu familia o tomar como punto de partida.

Si te interesa replicarla, colaborar o simplemente charlar sobre la idea, abre un issue o contáctame.

------

## Cómo empezar

1. Instala las dependencias:

```bash
npm install
```

2. Inicia la caja según dónde la ejecutes. En ambos casos el proceso **queda corriendo** y se usa **un solo botón** (mantén pulsado para grabar, suelta para terminar):

En la Raspberry Pi (botón GPIO + `arecord` / `aplay`):

```bash
npm start
```

En la Mac, durante el desarrollo (espacio para grabar, `p` para oír la última; hace falta permiso de Accesibilidad para el terminal):

```bash
npm run start:dev
```

**Calidad de audio en Mac (`start:dev`):** puede sonar mal — baja calidad, clicks y microcortes. No es un fallo de este proyecto ni del terminal: en macOS, la captura por `ffmpeg` + AVFoundation tiene ese problema conocido. El modo dev sirve para probar el flujo (botón, tiempos, archivos), no para juzgar la calidad final del micrófono. La calidad real se evalúa en la Raspberry Pi (`npm start`).

Ctrl+C para salir.

Para escuchar la última grabación:

```bash
npm run play:last
```

Para vaciar la carpeta `recordings/`:

```bash
npm run clear:recordings
```

------

## Estado

Proyecto en etapa inicial.

------

## Licencia

[MIT](LICENSE)
