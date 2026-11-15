import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'partials.regions': { paramsTuple?: []; params?: {} }
    'partials.discover': { paramsTuple?: []; params?: {} }
    'partials.cell': { paramsTuple: [ParamValue]; params: {'cellId': ParamValue} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'partials.regions': { paramsTuple?: []; params?: {} }
    'partials.discover': { paramsTuple?: []; params?: {} }
    'partials.cell': { paramsTuple: [ParamValue]; params: {'cellId': ParamValue} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'partials.regions': { paramsTuple?: []; params?: {} }
    'partials.discover': { paramsTuple?: []; params?: {} }
    'partials.cell': { paramsTuple: [ParamValue]; params: {'cellId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}