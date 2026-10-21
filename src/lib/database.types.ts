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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_generations: {
        Row: {
          accounted_tokens: number
          applied_operation_id: string | null
          context_fingerprint: string
          created_at: string
          editor_session_id: string
          error_code: string | null
          expires_at: string
          finished_at: string | null
          id: string
          map_id: string
          model: string
          parent_node_id: string
          request_hash: string
          requested_by: string
          reserved_tokens: number
          result: Json | null
          state: string
          usage: Json | null
          usage_day: string
          workspace_id: string
        }
        Insert: {
          accounted_tokens: number
          applied_operation_id?: string | null
          context_fingerprint: string
          created_at?: string
          editor_session_id: string
          error_code?: string | null
          expires_at?: string
          finished_at?: string | null
          id: string
          map_id: string
          model: string
          parent_node_id: string
          request_hash: string
          requested_by: string
          reserved_tokens: number
          result?: Json | null
          state: string
          usage?: Json | null
          usage_day: string
          workspace_id: string
        }
        Update: {
          accounted_tokens?: number
          applied_operation_id?: string | null
          context_fingerprint?: string
          created_at?: string
          editor_session_id?: string
          error_code?: string | null
          expires_at?: string
          finished_at?: string | null
          id?: string
          map_id?: string
          model?: string
          parent_node_id?: string
          request_hash?: string
          requested_by?: string
          reserved_tokens?: number
          result?: Json | null
          state?: string
          usage?: Json | null
          usage_day?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      map_operations: {
        Row: {
          actor_id: string
          after_data: Json
          base_revision: number | null
          before_data: Json | null
          created_at: string
          editor_session_id: string
          id: string
          kind: string
          map_id: string
          request_hash: string
          result_revision: number
          undone_operation_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_id: string
          after_data: Json
          base_revision?: number | null
          before_data?: Json | null
          created_at?: string
          editor_session_id: string
          id: string
          kind: string
          map_id: string
          request_hash: string
          result_revision: number
          undone_operation_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string
          after_data?: Json
          base_revision?: number | null
          before_data?: Json | null
          created_at?: string
          editor_session_id?: string
          id?: string
          kind?: string
          map_id?: string
          request_hash?: string
          result_revision?: number
          undone_operation_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "map_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_operations_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_operations_undone_operation_id_fkey"
            columns: ["undone_operation_id"]
            isOneToOne: false
            referencedRelation: "map_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_operations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      map_user_preferences: {
        Row: {
          collapsed_node_ids: string[]
          map_id: string
          user_id: string
          viewport: Json
        }
        Insert: {
          collapsed_node_ids?: string[]
          map_id: string
          user_id: string
          viewport: Json
        }
        Update: {
          collapsed_node_ids?: string[]
          map_id?: string
          user_id?: string
          viewport?: Json
        }
        Relationships: [
          {
            foreignKeyName: "map_user_preferences_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "map_user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maps: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          owner_id: string
          project_id: string | null
          revision: number
          title: string
          updated_at: string
          updated_by: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          owner_id: string
          project_id?: string | null
          revision?: number
          title: string
          updated_at?: string
          updated_by: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          owner_id?: string
          project_id?: string | null
          revision?: number
          title?: string
          updated_at?: string
          updated_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maps_project_workspace_fkey"
            columns: ["workspace_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "maps_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          ai_generation_id: string | null
          created_at: string
          created_by: string
          id: string
          map_id: string
          parent_id: string | null
          sort_order: number
          source: string
          text: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          ai_generation_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          map_id: string
          parent_id?: string | null
          sort_order?: number
          source?: string
          text: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          ai_generation_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          map_id?: string
          parent_id?: string | null
          sort_order?: number
          source?: string
          text?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_map_id_parent_id_fkey"
            columns: ["map_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["map_id", "id"]
          },
          {
            foreignKeyName: "nodes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_name: string | null
          created_at: string
          created_by: string
          creation_hash: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          created_by: string
          creation_hash: string
          id: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_name?: string | null
          created_at?: string
          created_by?: string
          creation_hash?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          attempt_id: string | null
          auth_user_id: string | null
          created_at: string
          delivery_error: string | null
          delivery_state: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          last_attempt_at: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          attempt_id?: string | null
          auth_user_id?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_state?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          last_attempt_at?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          attempt_id?: string | null
          auth_user_id?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_state?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_attempt_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          role: string
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          role: string
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          role?: string
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invitation: { Args: { p_id: string }; Returns: string }
      ai_generation_available: { Args: { p_actor: string }; Returns: boolean }
      apply_map_command: {
        Args: {
          p_editor_session_id: string
          p_expected_revision: number
          p_kind: string
          p_map_id: string
          p_operation_id: string
          p_payload: Json
        }
        Returns: Json
      }
      apply_map_history: {
        Args: {
          p_editor_session_id: string
          p_expected_revision: number
          p_map_id: string
          p_mode: string
          p_operation_id: string
          p_target_operation_id: string
        }
        Returns: Json
      }
      cancel_ai_generation: {
        Args: { p_generation_id: string; p_map_id: string }
        Returns: Json
      }
      create_map: {
        Args: {
          p_editor_session_id: string
          p_operation_id: string
          p_title?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_map_copy: {
        Args: {
          p_editor_session_id: string
          p_nodes: Json
          p_operation_id: string
          p_source_map_id: string
          p_title: string
        }
        Returns: Json
      }
      create_project: {
        Args: {
          p_client_name?: string
          p_name: string
          p_project_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      duplicate_map: {
        Args: {
          p_editor_session_id: string
          p_operation_id: string
          p_source_map_id: string
        }
        Returns: Json
      }
      finish_ai_generation: {
        Args: {
          p_children: Json
          p_error: string
          p_generation_id: string
          p_usage: Json
        }
        Returns: Json
      }
      finish_workspace_invitation: {
        Args: { p_attempt: string; p_id: string; p_outcome: string }
        Returns: undefined
      }
      get_ai_generation: {
        Args: {
          p_editor_session_id?: string
          p_generation_id?: string
          p_map_id: string
        }
        Returns: Json
      }
      get_map_document: { Args: { p_map_id: string }; Returns: Json }
      import_map_backup: {
        Args: {
          p_backup: Json
          p_editor_session_id: string
          p_operation_id: string
        }
        Returns: Json
      }
      list_map_library: {
        Args: {
          p_owner_id?: string
          p_page?: number
          p_project_id?: string
          p_query?: string
          p_without_project?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      pending_workspace_invitations: {
        Args: never
        Returns: {
          email: string
          expires_at: string
          id: string
          workspace_name: string
        }[]
      }
      rename_project: {
        Args: { p_client_name?: string; p_name: string; p_project_id: string }
        Returns: Json
      }
      reserve_ai_generation: {
        Args: {
          p_actor: string
          p_daily_budget: number
          p_editor_session_id: string
          p_generation_id: string
          p_guidance: string
          p_map_id: string
          p_model: string
          p_parent_node_id: string
        }
        Returns: Json
      }
      reserve_workspace_invitation: {
        Args: {
          p_action: string
          p_actor: string
          p_email?: string
          p_id: string
          p_workspace: string
        }
        Returns: Json
      }
      set_ai_validation_access: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_member_access: {
        Args: { p_status: string; p_user: string; p_workspace: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
