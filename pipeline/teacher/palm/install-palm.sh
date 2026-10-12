#!/usr/bin/env bash
# Build PALM (palm_model_system) under WSL2 Ubuntu for the stability teacher
# (docs/TEACHER.md, Track A). Tested on XEVO's WSL2 Ubuntu 24.04 on 2026-10-11
# in the default user-space mode; the apt mode is PALM's own README recipe.
#
#   bash install-palm.sh                 # user space: micromamba + conda-forge, no root
#   bash install-palm.sh --apt           # Ubuntu packages (asks for the sudo password)
#   bash install-palm.sh --prefix ~/palm/v25.10.1 --version v25.10.1 --no-test
#
# What it leaves:
#   $PREFIX/bin/palmrun, palmbuild, palm_csd ...      the model system
#   $PREFIX/.palm.config.default                      the build/run config
#   $PREFIX/MAKE_DEPOSITORY_default/                  the compiled model
#   $PREFIX/palm-env.sh                               source this before palmrun
#   $PREFIX/install-palm.log                          timings and the smoke test
#
# On XEVO: toolchain 47 s (micromamba), PALM 148 s, and the smoke test (PALM's
# example_cbl on 4 cores) 7 s.
# Note: PALM's installer and palmrun send a version check to
# api.palm-model.com (1 s timeout; nothing personal, see PALM's README).
set -euo pipefail

VERSION=v25.10.1
MODE=conda
PREFIX="$HOME/palm/v25.10.1"
SRC="$HOME/palm-src"
ENV_NAME=palm
TEST=1
CORES=4

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apt) MODE=apt ;;
    --conda) MODE=conda ;;
    --prefix) PREFIX="$2"; shift ;;
    --version) VERSION="$2"; shift ;;
    --src) SRC="$2"; shift ;;
    --cores) CORES="$2"; shift ;;
    --no-test) TEST=0 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done

mkdir -p "$PREFIX" "$SRC"
LOG="$PREFIX/install-palm.log"
exec > >(tee -a "$LOG") 2>&1
stamp() { date +%s; }
T0=$(stamp)
echo "== install-palm.sh $(date -Is) mode=$MODE version=$VERSION prefix=$PREFIX"
echo "== $(uname -a)"
echo "== cores $(nproc), memory $(free -g | awk '/Mem:/{print $2}') GB"

# ---------------------------------------------------------------- toolchain
if [[ "$MODE" == apt ]]; then
  sudo apt-get update
  # PALM's README list without ncl-ncarg (gone from new Ubuntu) and the Qt GUI
  sudo apt-get install -y gfortran g++ make cmake coreutils libopenmpi-dev openmpi-bin \
    libnetcdff-dev netcdf-bin libfftw3-dev python3-pip python3-venv flex bison curl
  python3 -m venv "$PREFIX/venv"
  "$PREFIX/venv/bin/pip" install -q numpy scipy netCDF4 pyyaml
  cat > "$PREFIX/palm-env.sh" <<EOF
# source me before palmrun
source "$PREFIX/venv/bin/activate"
export PATH="$PREFIX/bin:\$PATH"
export OMP_NUM_THREADS=1
# more ranks than cores: OpenMPI 4 (Ubuntu 24.04) and 5 spell it differently
export OMPI_MCA_rmaps_base_oversubscribe=1
export PRTE_MCA_rmaps_default_mapping_policy=:oversubscribe
EOF
else
  MM="$HOME/.local/bin/micromamba"
  export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-$HOME/micromamba}"
  if [[ ! -x "$MM" ]]; then
    mkdir -p "$HOME/.local"
    # a fresh Ubuntu 24.04 under WSL has no bzip2, and tar dies unpacking
    # micromamba without it (xonix, 2026-10-12)
    command -v bzip2 >/dev/null || { echo "bzip2 is missing: sudo apt-get update && sudo apt-get install -y bzip2, then run this again"; exit 1; }
    (cd "$HOME/.local" && curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj bin/micromamba)
  fi
  if [[ ! -d "$MAMBA_ROOT_PREFIX/envs/$ENV_NAME" ]]; then
    # nompi NetCDF: PALM writes through its own MPI layer (no parallel NetCDF-4 I/O needed).
    # Fortran .mod files only load in the gfortran generation that wrote them:
    # conda-forge's OpenMPI Fortran bindings are built with gfortran 14, and
    # netcdf-fortran 4.6.4's _100 builds too (its _101 builds are gfortran 15).
    # CMake 3: CMake 4 refuses PALM's old cmake_minimum_required.
    "$MM" create -y -n "$ENV_NAME" -c conda-forge "gfortran=14" "gcc=14" "gxx=14" make "cmake>=3.20,<4" \
      "openmpi=5" "netcdf-fortran=4.6.4=nompi_*_100" "libnetcdf=*=nompi*" fftw python=3.12 numpy scipy netcdf4 pyyaml flex bison
  fi
  modv() { zcat "$1" 2>/dev/null | head -c 40 | sed -n "s/.*version '\([0-9]*\)'.*/\1/p"; }
  ENVI="$MAMBA_ROOT_PREFIX/envs/$ENV_NAME/include"
  if [[ "$(modv "$ENVI/mpi.mod")" != "$(modv "$ENVI/netcdf.mod")" ]]; then
    echo "== mpi.mod (format $(modv "$ENVI/mpi.mod")) and netcdf.mod (format $(modv "$ENVI/netcdf.mod")) come from different gfortran generations: remove $MAMBA_ROOT_PREFIX/envs/$ENV_NAME and fix the pins"
    exit 1
  fi
  ENVP="$MAMBA_ROOT_PREFIX/envs/$ENV_NAME"
  cat > "$PREFIX/palm-env.sh" <<EOF
# source me before palmrun
export MAMBA_ROOT_PREFIX="$MAMBA_ROOT_PREFIX"
eval "\$("$MM" shell hook -s bash)"
micromamba activate "$ENV_NAME"
export PATH="$PREFIX/bin:\$PATH"
export LD_LIBRARY_PATH="$ENVP/lib:\${LD_LIBRARY_PATH:-}"
export OMP_NUM_THREADS=1
# conda's OpenMPI under WSL: no InfiniBand, shared-memory transport only
export OMPI_MCA_btl=self,vader
export OMPI_MCA_pml=ob1
# OpenMPI 5 (PRRTE) counts cores, not hardware threads: WSL on XEVO shows 8 cores
# for 16 threads, and 12 ranks were refused. Let it place more ranks than that.
export PRTE_MCA_rmaps_default_mapping_policy=:oversubscribe
EOF
fi
# a CMake 4 (an older env, or a newer distro) still configures PALM's packages with this
echo 'export CMAKE_POLICY_VERSION_MINIMUM=3.5' >> "$PREFIX/palm-env.sh"
# shellcheck disable=SC1091
source "$PREFIX/palm-env.sh"
echo "== toolchain: $(command -v gfortran) $(gfortran -dumpfullversion); mpif90 $(command -v mpif90); $(mpirun --version | head -1); $(cmake --version | head -1); nf-config $(nf-config --version)"
T1=$(stamp); echo "== toolchain ready in $((T1 - T0)) s"

# ---------------------------------------------------------------- source
TARBALL="$SRC/palm_model_system-$VERSION.tar.gz"
if [[ ! -d "$SRC/palm_model_system-$VERSION" ]]; then
  [[ -f "$TARBALL" ]] || curl -sS -L --fail -o "$TARBALL" \
    "https://gitlab.palm-model.org/releases/palm_model_system/-/archive/$VERSION/palm_model_system-$VERSION.tar.gz"
  tar -xzf "$TARBALL" -C "$SRC"
fi
T2=$(stamp); echo "== source ready in $((T2 - T1)) s"

# ---------------------------------------------------------------- build
cd "$SRC/palm_model_system-$VERSION"
# nf-config in a conda build reports the compiler it was built with, which is
# not on this machine: hand the installer the env's own gfortran and NetCDF.
NCC_PREFIX="$(nc-config --prefix)"
NCF_PREFIX="$(nf-config --prefix)"
# 'y' answers the installer's one question (continue if an optional tool is missing)
bash install -p "$PREFIX" -c gfortran -s "$NCC_PREFIX" -t "$NCF_PREFIX" < <(yes y)
T3=$(stamp); echo "== PALM built in $((T3 - T2)) s"

if [[ ! -x "$PREFIX/MAKE_DEPOSITORY_default/palm" ]]; then
  echo "== BUILD FAILED: no $PREFIX/MAKE_DEPOSITORY_default/palm (see $LOG)"; exit 1
fi
grep -E "^%(compiler_name|cpp_options|compiler_options|linker_options|execute_command)" "$PREFIX/.palm.config.default" || true

# ---------------------------------------------------------------- smoke test
if [[ "$TEST" == 1 ]]; then
  CASE=example_cbl
  mkdir -p "$PREFIX/JOBS/$CASE/INPUT"
  cp "packages/palm/model/tests/cases/$CASE/INPUT/${CASE}_p3d" "$PREFIX/JOBS/$CASE/INPUT/"
  cd "$PREFIX"
  T4=$(stamp)
  # -v: no questions; stdin from /dev/null, since palmrun pipes files through
  # more(1), which spins forever on an endless 'yes'
  palmrun -r "$CASE" -c default -a "d3#" -X "$CORES" -T "$CORES" -v -z < /dev/null || echo "== smoke test FAILED"
  T5=$(stamp); echo "== smoke test ($CASE, $CORES cores) in $((T5 - T4)) s"
  ls "$PREFIX/JOBS/$CASE/OUTPUT/" 2>/dev/null | head
fi
echo "== total $(( $(stamp) - T0 )) s; log $LOG"
