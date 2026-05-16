export type LuaValue =
  | string
  | number
  | boolean
  | null
  | LuaValue[]
  | { [key: string]: LuaValue };

export type LuaTable = LuaValue[] | { [key: string]: LuaValue };
