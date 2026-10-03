<script lang="ts">
  import { onMount } from 'svelte';
  import { renderSlide } from './lib/svg';
  import type { Presentation, Slide } from './lib/model';
  export let slide: Slide;
  export let theme: Presentation['theme'];
  let svg: SVGSVGElement;
  $: if (svg && slide && theme) renderSlide(svg, slide, { title:'', theme, slides:[slide] });
</script>

<svg bind:this={svg} aria-hidden="true" class="mini-svg"></svg>

<style>
  .mini-svg{display:block;width:100%;height:100%;overflow:hidden;pointer-events:none}
</style>
