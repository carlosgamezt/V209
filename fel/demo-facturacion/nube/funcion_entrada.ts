// Punto de entrada de la Supabase Edge Function (lo copia construir.ts como index.ts).
import { crearManejador } from "./funcion.ts";
Deno.serve(crearManejador({ get: (k) => Deno.env.get(k) }));
