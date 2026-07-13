export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      auth_admins: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: number
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: number
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: number
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      buildings: {
        Row: {
          address: string
          bu: string | null
          cluster: string | null
          created_at: string
          id: number
          lat: number
          lng: number
          manager: string | null
          building_operator: string | null
          operator_phone: string | null
          ops_manager: string | null
          gm_ops: string | null
          vp: string | null
          map_heading: number | null
          map_imagery_mode: string | null
          map_lat: number | null
          map_lng: number | null
          map_tilt: number | null
          map_zoom: number | null
          notes: string | null
          park: string
          sold: boolean
          sqft: string | null
          updated_at: string
        }
        Insert: {
          address: string
          bu?: string | null
          cluster?: string | null
          created_at?: string
          id?: number
          lat: number
          lng: number
          manager?: string | null
          building_operator?: string | null
          operator_phone?: string | null
          ops_manager?: string | null
          gm_ops?: string | null
          vp?: string | null
          map_heading?: number | null
          map_imagery_mode?: string | null
          map_lat?: number | null
          map_lng?: number | null
          map_tilt?: number | null
          map_zoom?: number | null
          notes?: string | null
          park: string
          sold?: boolean
          sqft?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          bu?: string | null
          cluster?: string | null
          created_at?: string
          id?: number
          lat?: number
          lng?: number
          manager?: string | null
          building_operator?: string | null
          operator_phone?: string | null
          ops_manager?: string | null
          gm_ops?: string | null
          vp?: string | null
          map_heading?: number | null
          map_imagery_mode?: string | null
          map_lat?: number | null
          map_lng?: number | null
          map_tilt?: number | null
          map_zoom?: number | null
          notes?: string | null
          park?: string
          sold?: boolean
          sqft?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      polygons: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: number
          name: string
          paths: Json
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: number
          name: string
          paths: Json
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: number
          name?: string
          paths?: Json
          updated_at?: string
        }
        Relationships: []
      }
      rtus: {
        Row: {
          building_id: number
          cooling_tons: number | null
          created_at: string
          description: string | null
          heating_btu: string | null
          id: number
          install_date: string | null
          install_year: number | null
          lat: number
          lng: number
          make: string | null
          model: string | null
          name: string
          replacement_note: string | null
          replacement_year: number | null
          serial: string | null
          suite: string | null
          updated_at: string
        }
        Insert: {
          building_id: number
          cooling_tons?: number | null
          created_at?: string
          description?: string | null
          heating_btu?: string | null
          id?: number
          install_date?: string | null
          install_year?: number | null
          lat: number
          lng: number
          make?: string | null
          model?: string | null
          name: string
          replacement_note?: string | null
          replacement_year?: number | null
          serial?: string | null
          suite?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: number
          cooling_tons?: number | null
          created_at?: string
          description?: string | null
          heating_btu?: string | null
          id?: number
          install_date?: string | null
          install_year?: number | null
          lat?: number
          lng?: number
          make?: string | null
          model?: string | null
          name?: string
          replacement_note?: string | null
          replacement_year?: number | null
          serial?: string | null
          suite?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rtus_building_id_fkey'
            columns: ['building_id']
            isOneToOne: false
            referencedRelation: 'buildings'
            referencedColumns: ['id']
          },
        ]
      }
      rtu_documents: {
        Row: {
          building_address: string
          created_at: string
          doc_type: string | null
          file_name: string
          id: number
          position: number
          rtu_id: number | null
          rtu_name: string
          title: string | null
          updated_at: string
        }
        Insert: {
          building_address: string
          created_at?: string
          doc_type?: string | null
          file_name: string
          id?: number
          position?: number
          rtu_id?: number | null
          rtu_name: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          building_address?: string
          created_at?: string
          doc_type?: string | null
          file_name?: string
          id?: number
          position?: number
          rtu_id?: number | null
          rtu_name?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rtu_documents_rtu_id_fkey'
            columns: ['rtu_id']
            isOneToOne: false
            referencedRelation: 'rtus'
            referencedColumns: ['id']
          },
        ]
      }
      rtu_pictures: {
        Row: {
          building_address: string
          created_at: string
          file_name: string
          hidden: boolean
          id: number
          position: number
          rtu_id: number | null
          rtu_name: string
          updated_at: string
        }
        Insert: {
          building_address: string
          created_at?: string
          file_name: string
          hidden?: boolean
          id?: number
          position?: number
          rtu_id?: number | null
          rtu_name: string
          updated_at?: string
        }
        Update: {
          building_address?: string
          created_at?: string
          file_name?: string
          hidden?: boolean
          id?: number
          position?: number
          rtu_id?: number | null
          rtu_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rtu_pictures_rtu_id_fkey'
            columns: ['rtu_id']
            isOneToOne: false
            referencedRelation: 'rtus'
            referencedColumns: ['id']
          },
        ]
      }
      rtu_pricing: {
        Row: {
          consulting: number
          created_at: string
          electrical: number
          id: number
          install: number
          label: string
          miscellaneous: number
          model: string
          notes: string
          position: number
          service_balancing: number
          structural: number
          supervisory_mult: number
          supply_hyb: number
          supply_std: number
          tonnage_key: number
          updated_at: string
        }
        Insert: {
          consulting?: number
          created_at?: string
          electrical?: number
          id?: number
          install?: number
          label: string
          miscellaneous?: number
          model?: string
          notes?: string
          position?: number
          service_balancing?: number
          structural?: number
          supervisory_mult?: number
          supply_hyb?: number
          supply_std?: number
          tonnage_key: number
          updated_at?: string
        }
        Update: {
          consulting?: number
          created_at?: string
          electrical?: number
          id?: number
          install?: number
          label?: string
          miscellaneous?: number
          model?: string
          notes?: string
          position?: number
          service_balancing?: number
          structural?: number
          supervisory_mult?: number
          supply_hyb?: number
          supply_std?: number
          tonnage_key?: number
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          auto_placed: boolean
          building_id: number
          created_at: string
          description: string | null
          id: number
          inspection_url: string | null
          lat: number
          lng: number
          name: string
          polygon_id: number | null
          updated_at: string
        }
        Insert: {
          auto_placed?: boolean
          building_id: number
          created_at?: string
          description?: string | null
          id?: number
          inspection_url?: string | null
          lat: number
          lng: number
          name: string
          polygon_id?: number | null
          updated_at?: string
        }
        Update: {
          auto_placed?: boolean
          building_id?: number
          created_at?: string
          description?: string | null
          id?: number
          inspection_url?: string | null
          lat?: number
          lng?: number
          name?: string
          polygon_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenants_building_id_fkey'
            columns: ['building_id']
            isOneToOne: false
            referencedRelation: 'buildings'
            referencedColumns: ['id']
          },
        ]
      }
      utilities: {
        Row: {
          created_at: string
          description: string | null
          id: number
          inspection_url: string | null
          lat: number
          lng: number
          name: string
          updated_at: string
          utility_type: Database['public']['Enums']['utility_type']
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          inspection_url?: string | null
          lat: number
          lng: number
          name: string
          updated_at?: string
          utility_type: Database['public']['Enums']['utility_type']
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          inspection_url?: string | null
          lat?: number
          lng?: number
          name?: string
          updated_at?: string
          utility_type?: Database['public']['Enums']['utility_type']
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_app_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      utility_type:
        | 'Sprinkler Rooms'
        | 'Electrical Rooms'
        | 'Fire Hydrants'
        | 'Natural Gas Shut-Off'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      utility_type: [
        'Sprinkler Rooms',
        'Electrical Rooms',
        'Fire Hydrants',
        'Natural Gas Shut-Off',
      ],
    },
  },
} as const
