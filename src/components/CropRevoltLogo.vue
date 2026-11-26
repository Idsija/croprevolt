<script setup lang="ts">
defineProps<{
  compact?: boolean;
}>();
</script>

<template>
  <div class="logo-wrap" :class="{ compact }">
    <img
      src="/sprites/logo.png"
      alt="Crop Revolt!"
      class="papercraft-logo-img"
      draggable="false"
    />
  </div>
</template>

<style scoped>
.logo-wrap {
  width: min(336px, 84vw);
  margin: 2px auto 0;
  line-height: 0;
  animation: gentlePaperLift 4.4s ease-in-out infinite;
}

.logo-wrap.compact {
  width: 188px;
  animation: none;
}

.papercraft-logo-img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
  filter: drop-shadow(0 5px 6px rgba(42, 20, 6, 0.28));
  pointer-events: none;
}

@keyframes gentlePaperLift {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-2.5px) rotate(0.3deg);
  }
}
</style>
