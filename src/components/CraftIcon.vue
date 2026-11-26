<script setup lang="ts">
export type CraftIconName =
  | 'move'
  | 'attack'
  | 'skill'
  | 'bag'
  | 'undo'
  | 'iso'
  | 'topdown'
  | 'center'
  | 'menu'
  | 'sound_on'
  | 'sound_off'
  | 'play'
  | 'end_turn'
  | 'seed'
  | 'shield_full'
  | 'shield_half'
  | 'heart'
  | 'trophy'
  | 'book'
  | 'shed'
  | 'check'
  | 'close'
  | 'map'
  | 'squad'
  | 'dash'
  | 'auto_end'
  | 'warning'
  | 'star';

defineProps<{
  name: CraftIconName;
  size?: number;
}>();
</script>

<template>
  <svg
    class="craft-ico"
    :width="size ?? 20"
    :height="size ?? 20"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- Move: directional boot / stepping arrows -->
    <template v-if="name === 'move'">
      <path
        d="M12 3L15.5 7H13.3V10.7H17V8.5L21 12L17 15.5V13.3H13.3V17H15.5L12 21L8.5 17H10.7V13.3H7V15.5L3 12L7 8.5V10.7H10.7V7H8.5L12 3Z"
        fill="currentColor"
        fill-opacity="0.2"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
    </template>

    <!-- Attack: crisp hand-inked crosshair burst -->
    <template v-else-if="name === 'attack'">
      <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2.2" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path
        d="M12 2.5V6M12 18V21.5M2.5 12H6M18 12H21.5"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </template>

    <!-- Skill: four-point craft star -->
    <template v-else-if="name === 'skill'">
      <path
        d="M12 2.5L14.5 9.2L21.5 12L14.5 14.8L12 21.5L9.5 14.8L2.5 12L9.5 9.2L12 2.5Z"
        fill="currentColor"
        fill-opacity="0.22"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
    </template>

    <!-- Bag: garden satchel -->
    <template v-else-if="name === 'bag'">
      <path
        d="M8 8V6.5C8 4.6 9.8 3.5 12 3.5C14.2 3.5 16 4.6 16 6.5V8"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <rect
        x="4.5"
        y="8"
        width="15"
        height="12.5"
        rx="3.5"
        fill="currentColor"
        fill-opacity="0.18"
        stroke="currentColor"
        stroke-width="2.2"
      />
      <path d="M4.5 12.5H19.5" stroke="currentColor" stroke-width="2" />
      <circle cx="12" cy="12.5" r="1.7" fill="currentColor" />
    </template>

    <!-- Undo: curved rewind arrow -->
    <template v-else-if="name === 'undo'">
      <path
        d="M9 7L4.5 11.2L9 15.5"
        stroke="currentColor"
        stroke-width="2.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M5.5 11.2H14.5C17.5 11.2 19.5 13.1 19.5 15.8C19.5 18.2 17.6 19.8 14.8 19.8H11"
        stroke="currentColor"
        stroke-width="2.3"
        stroke-linecap="round"
      />
    </template>

    <!-- Iso view: 2.5D diamond slab -->
    <template v-else-if="name === 'iso'">
      <path
        d="M12 4L21 9L12 14L3 9L12 4Z"
        fill="currentColor"
        fill-opacity="0.22"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path
        d="M3 9V14L12 19L21 14V9"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path d="M12 14V19" stroke="currentColor" stroke-width="2" />
    </template>

    <!-- Top-down view: crisp 2x2 square grid -->
    <template v-else-if="name === 'topdown'">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2.8"
        fill="currentColor"
        fill-opacity="0.16"
        stroke="currentColor"
        stroke-width="2.2"
      />
      <path d="M12 4V20M4 12H20" stroke="currentColor" stroke-width="2" />
    </template>

    <!-- Center camera -->
    <template v-else-if="name === 'center'">
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" stroke-width="2.2" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <path
        d="M12 3V5.5M12 18.5V21M3 12H5.5M18.5 12H21"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </template>

    <!-- Menu drawer -->
    <template v-else-if="name === 'menu'">
      <path
        d="M4.5 7H19.5M4.5 12H19.5M4.5 17H19.5"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      />
    </template>

    <!-- Sound On -->
    <template v-else-if="name === 'sound_on'">
      <path
        d="M4.5 9.5H8.5L13.5 5.5V18.5L8.5 14.5H4.5V9.5Z"
        fill="currentColor"
        fill-opacity="0.2"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path
        d="M16.8 9C17.8 10 18.3 11 18.3 12C18.3 13 17.8 14 16.8 15M19.2 6.8C20.8 8.2 21.5 10 21.5 12C21.5 14 20.8 15.8 19.2 17.2"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </template>

    <!-- Sound Off -->
    <template v-else-if="name === 'sound_off'">
      <path
        d="M4.5 9.5H8.5L13.5 5.5V18.5L8.5 14.5H4.5V9.5Z"
        fill="currentColor"
        fill-opacity="0.16"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path
        d="M16.5 9.5L21 14M21 9.5L16.5 14"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </template>

    <!-- Play / End Turn arrow -->
    <template v-else-if="name === 'play' || name === 'end_turn'">
      <path
        d="M6.5 5L18.5 12L6.5 19V5Z"
        fill="currentColor"
        fill-opacity="0.25"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
    </template>

    <!-- Seed / Acorn -->
    <template v-else-if="name === 'seed'">
      <path
        d="M12 4C8.2 6.4 6.5 10.2 6.5 13.8C6.5 17.4 9 20 12 20C15 20 17.5 17.4 17.5 13.8C17.5 10.2 15.8 6.4 12 4Z"
        fill="currentColor"
        fill-opacity="0.24"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
      <path d="M12 8.5V16.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
    </template>

    <!-- Full Shield -->
    <template v-else-if="name === 'shield_full'">
      <path
        d="M12 3.2L19.5 6.4V11.8C19.5 16.4 16.3 19.6 12 21C7.7 19.6 4.5 16.4 4.5 11.8V6.4L12 3.2Z"
        fill="currentColor"
        fill-opacity="0.32"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
    </template>

    <!-- Half Shield -->
    <template v-else-if="name === 'shield_half'">
      <path
        d="M12 3.2L19.5 6.4V11.8C19.5 16.4 16.3 19.6 12 21C7.7 19.6 4.5 16.4 4.5 11.8V6.4L12 3.2Z"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
      <path
        d="M12 3.2L19.5 6.4V11.8C19.5 16.4 16.3 19.6 12 21V3.2Z"
        fill="currentColor"
        fill-opacity="0.45"
      />
    </template>

    <!-- Heart -->
    <template v-else-if="name === 'heart'">
      <path
        d="M12 20C12 20 4.5 15.2 4.5 9.6C4.5 6.9 6.6 5 9 5C10.5 5 11.5 5.8 12 6.8C12.5 5.8 13.5 5 15 5C17.4 5 19.5 6.9 19.5 9.6C19.5 15.2 12 20 12 20Z"
        fill="currentColor"
        fill-opacity="0.28"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
    </template>

    <!-- Trophy -->
    <template v-else-if="name === 'trophy'">
      <path
        d="M7 4.5H17V10.5C17 13.5 14.8 15.5 12 15.5C9.2 15.5 7 13.5 7 10.5V4.5Z"
        fill="currentColor"
        fill-opacity="0.22"
        stroke="currentColor"
        stroke-width="2.1"
      />
      <path
        d="M7 6.5H4.2C4.2 9.4 5.2 11 7 11.2M17 6.5H19.8C19.8 9.4 18.8 11 17 11.2M12 15.5V19.5M8.5 19.5H15.5"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linecap="round"
      />
    </template>

    <!-- Book / Field Guide -->
    <template v-else-if="name === 'book'">
      <path
        d="M4.5 6C4.5 5 5.5 4.2 7 4.2H11.5V19.2H7C5.5 19.2 4.5 18.5 4.5 17.5V6Z"
        fill="currentColor"
        fill-opacity="0.16"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path
        d="M19.5 6C19.5 5 18.5 4.2 17 4.2H12.5V19.2H17C18.5 19.2 19.5 18.5 19.5 17.5V6Z"
        fill="currentColor"
        fill-opacity="0.16"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
    </template>

    <!-- Seed Shed / Barn -->
    <template v-else-if="name === 'shed'">
      <path
        d="M3.5 11.5L12 4.5L20.5 11.5"
        stroke="currentColor"
        stroke-width="2.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M6 10.2V19.5H18V10.2"
        fill="currentColor"
        fill-opacity="0.18"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
      <rect x="9.8" y="13.5" width="4.4" height="6" rx="1" stroke="currentColor" stroke-width="1.9" />
    </template>

    <!-- Map Trail -->
    <template v-else-if="name === 'map'">
      <path
        d="M3.5 6.5L9 4.5L15 6.8L20.5 4.8V17.5L15 19.5L9 17.2L3.5 19.2V6.5Z"
        fill="currentColor"
        fill-opacity="0.18"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path d="M9 4.5V17.2M15 6.8V19.5" stroke="currentColor" stroke-width="1.8" />
    </template>

    <!-- Squad -->
    <template v-else-if="name === 'squad'">
      <circle cx="9" cy="8.5" r="3" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" />
      <circle cx="16.5" cy="9.5" r="2.4" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" />
      <path
        d="M4.2 18.8C4.6 15.8 6.5 14.2 9 14.2C11.5 14.2 13.4 15.8 13.8 18.8M14 18.8C14.3 16.6 15.5 15.4 17.2 15.4C18.9 15.4 20 16.6 20.2 18.8"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linecap="round"
      />
    </template>

    <!-- Check -->
    <template v-else-if="name === 'check'">
      <path
        d="M5 12.8L9.6 17.4L19 7.5"
        stroke="currentColor"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>

    <!-- Close -->
    <template v-else-if="name === 'close'">
      <path
        d="M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </template>

    <!-- Dash: forward lightning bolt charge -->
    <template v-else-if="name === 'dash'">
      <path
        d="M13.5 2.8L5.5 13H11.5L10.5 21.2L18.5 11H12.5L13.5 2.8Z"
        fill="currentColor"
        fill-opacity="0.26"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
    </template>

    <!-- Auto-End Turn: double skip chevron -->
    <template v-else-if="name === 'auto_end'">
      <path
        d="M5 6.5L11.5 12L5 17.5V6.5ZM13 6.5L19.5 12L13 17.5V6.5Z"
        fill="currentColor"
        fill-opacity="0.24"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </template>

    <!-- Threat Warning Triangle -->
    <template v-else-if="name === 'warning'">
      <path
        d="M12 3.8L20.5 19H3.5L12 3.8Z"
        fill="currentColor"
        fill-opacity="0.22"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linejoin="round"
      />
      <path d="M12 9.5V13.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="12" cy="16.6" r="1.15" fill="currentColor" />
    </template>

    <!-- Co-op Star -->
    <template v-else-if="name === 'star'">
      <path
        d="M12 3.2L14.7 8.8L20.8 9.6L16.3 13.9L17.5 20L12 17L6.5 20L7.7 13.9L3.2 9.6L9.3 8.8L12 3.2Z"
        fill="currentColor"
        fill-opacity="0.26"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </template>
  </svg>
</template>

<style scoped>
.craft-ico {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 1px 0 rgba(74, 44, 23, 0.16));
}
</style>
