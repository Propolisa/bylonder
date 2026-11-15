/* FFTW's threads API (fftw3.h, single precision) as Blender's blenlib/intern/fftw.cc initialize_float calls it. The
 * module links FFTW without its threads library, so the planner is FFTW's single-threaded one, on the calling thread. */
#include <cstddef>

/* port-override: FFTW without its threads library plans and runs on the calling thread. */
extern "C" int fftwf_init_threads()
{
  return 1;
}

/* port-override: FFTW without its threads library has no planner lock to make. */
extern "C" void fftwf_make_planner_thread_safe() {}

/* port-override: FFTW without its threads library plans for one thread. */
extern "C" void fftwf_plan_with_nthreads(int /*nthreads*/) {}

/* port-override: FFTW without its threads library runs its jobs in its own loop. */
extern "C" void fftwf_threads_set_callback(void (* /*parallel_loop*/)(void *(*work)(char *), char *, size_t, int, void *),
                                           void * /*data*/)
{
}
