/* FFTW's threads API (fftw3.h, single precision) as Blender's blenlib/intern/fftw.cc initialize_float calls it. The
 * module runs on one thread and links FFTW without its threads library, so the planner is FFTW's single-threaded one. */
#include <cstddef>

/* port-override: the module is single-threaded; FFTW plans and runs on the calling thread. */
extern "C" int fftwf_init_threads()
{
  return 1;
}

/* port-override: the module is single-threaded; the planner needs no lock. */
extern "C" void fftwf_make_planner_thread_safe() {}

/* port-override: the module is single-threaded; plans use one thread. */
extern "C" void fftwf_plan_with_nthreads(int /*nthreads*/) {}

/* port-override: the module is single-threaded; FFTW's own loop runs the jobs. */
extern "C" void fftwf_threads_set_callback(void (* /*parallel_loop*/)(void *(*work)(char *), char *, size_t, int, void *),
                                           void * /*data*/)
{
}
