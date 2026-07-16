# CSV locales opcionales

El juego usa por defecto los dos Google Sheets publicados configurados en `game.js`.

Para que una instalación nueva también pueda arrancar sin acceso a Google Sheets, puedes añadir:

- `data/cromos.csv`
- `data/albumes.csv`

Formatos esperados:

```csv
id,nombre,rareza,tags
1,Nombre del cromo,N,TAG_ALBUM
```

```csv
id,nombre,tags,inicio,fin,costo
TOTOTO,Nombre del álbum,TAG_ALBUM,1,40,100
```

Los campos `inicio` y `fin` se conservan por compatibilidad; la asociación real se hace mediante `tags`.
